import logging
from decimal import Decimal, ROUND_HALF_UP
from math import isclose

import redis
from celery import shared_task
from django.conf import settings
from django.db import transaction
from apps.game_config.modules import get_module_config
from apps.game import metrics as game_metrics

logger = logging.getLogger(__name__)


def _round_elo_delta(value: float) -> int:
    if isclose(value, 0.0, abs_tol=1e-9):
        return 0

    rounded = int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if rounded == 0:
        return 1 if value > 0 else -1
    return rounded


def _balanced_round_elo_changes(raw_changes: list[float]) -> list[int]:
    rounded = [_round_elo_delta(change) for change in raw_changes]
    delta = -sum(rounded)
    if delta == 0:
        return rounded

    residuals = [
        (index, raw_changes[index] - rounded[index])
        for index in range(len(raw_changes))
    ]
    if delta > 0:
        residuals.sort(key=lambda item: item[1], reverse=True)
        for step in range(delta):
            index, _ = residuals[step % len(residuals)]
            rounded[index] += 1
    else:
        residuals.sort(key=lambda item: item[1])
        for step in range(abs(delta)):
            index, _ = residuals[step % len(residuals)]
            rounded[index] -= 1
    return rounded


def _safe_ratio(value: int, denominator: int) -> float:
    return float(value) / float(denominator) if denominator > 0 else 0.0


def finalize_match_results_sync(
    match_id: str,
    winner_id: str | None,
    total_ticks: int,
    final_state: dict,
):
    """Persist match results immediately and idempotently."""
    from django.utils import timezone

    from apps.game.models import GameStateSnapshot, MatchResult, PlayerResult
    from apps.game_config.models import GameSettings
    from apps.matchmaking.models import Match

    with transaction.atomic():
        match = Match.objects.select_for_update().get(id=match_id)
        if MatchResult.objects.filter(match=match).exists():
            logger.info("Match %s already finalized, skipping duplicate finalization", match_id)
            return

        match.status = Match.Status.FINISHED
        match.finished_at = timezone.now()
        match.winner_id = winner_id
        match.save(update_fields=["status", "finished_at", "winner"])

        GameStateSnapshot.objects.update_or_create(
            match=match,
            tick=total_ticks,
            defaults={"state_data": final_state},
        )

        duration = 0
        if match.started_at:
            duration = int((match.finished_at - match.started_at).total_seconds())

        result = MatchResult.objects.create(
            match=match,
            duration_seconds=duration,
            total_ticks=total_ticks,
        )

        regions = final_state.get("regions", {})
        players_data = final_state.get("players", {})
        snapshot_k = match.settings_snapshot.get("elo_k_factor") if match.settings_snapshot else None
        if snapshot_k is not None:
            k_factor = max(1, int(snapshot_k))
        else:
            settings_obj = GameSettings.get()
            k_factor = max(1, int(settings_obj.elo_k_factor))

        player_rows = []
        for mp in match.players.select_related("user").all():
            pid = str(mp.user_id)
            player_info = players_data.get(pid, {})

            owned_regions = int(player_info.get("total_regions_conquered", 0))
            total_units = int(player_info.get("total_units_produced", 0))
            cumulative_units_lost = int(player_info.get("total_units_lost", 0))
            buildings_count = int(player_info.get("total_buildings_built", 0))

            player_rows.append({
                "match_player": mp,
                "pid": pid,
                "is_bot": mp.user.is_bot,
                "is_alive": bool(player_info.get("is_alive", False)),
                "eliminated_reason": str(player_info.get("eliminated_reason") or ""),
                "eliminated_tick": int(player_info.get("eliminated_tick") or 0),
                "owned_regions": owned_regions,
                "total_units": total_units,
                "units_lost": cumulative_units_lost,
                "buildings_built": buildings_count,
                "rating_before": int(mp.user.elo_rating),
            })

        player_rows.sort(
            key=lambda row: (
                0 if row["pid"] == winner_id else 1,
                0 if row["is_alive"] else 1,
                -row["owned_regions"],
                -row["total_units"],
                row["match_player"].joined_at,
            )
        )

        for index, row in enumerate(player_rows, start=1):
            row["placement"] = index

        max_regions = max((row["owned_regions"] for row in player_rows), default=0)
        max_units = max((row["total_units"] for row in player_rows), default=0)
        max_buildings = max((row["buildings_built"] for row in player_rows), default=0)
        max_survival_ticks = max(total_ticks, 1)

        # Determine if match is ranked (configurable minimum human player count)
        min_human_players = get_module_config('leaderboard', 'min_human_players_for_ranked', 2)
        human_rows = [r for r in player_rows if not r["is_bot"]]
        is_ranked = len(human_rows) >= min_human_players

        raw_changes: list[float] = []
        for row in player_rows:
            if row["is_bot"] or not is_ranked:
                row["raw_elo_change"] = 0.0
                row["performance_score"] = 0.0
                row["base_elo_component"] = 0.0
                raw_changes.append(0.0)
                survived_ticks = row["eliminated_tick"] or total_ticks
                row["survived_ticks"] = survived_ticks
                continue

            placement_total = 0.0
            expected_total = 0.0
            for opponent in player_rows:
                if opponent["pid"] == row["pid"] or opponent["is_bot"]:
                    continue
                if row["placement"] < opponent["placement"]:
                    actual_score = 1.0
                elif row["placement"] > opponent["placement"]:
                    actual_score = 0.0
                else:
                    actual_score = 0.5
                expected_score = 1 / (
                    1 + 10 ** ((opponent["rating_before"] - row["rating_before"]) / 400)
                )
                placement_total += actual_score
                expected_total += expected_score

            survived_ticks = row["eliminated_tick"] or total_ticks
            row["survived_ticks"] = survived_ticks
            discipline_penalty = 0.0
            if row["eliminated_reason"] == "left_match":
                discipline_penalty = get_module_config('leaderboard', 'discipline_penalty_left_match', -0.2)
            elif row["eliminated_reason"] == "disconnect_timeout":
                discipline_penalty = get_module_config('leaderboard', 'discipline_penalty_disconnect', -0.12)

            w_regions = get_module_config('leaderboard', 'perf_weight_regions', 0.35)
            w_units = get_module_config('leaderboard', 'perf_weight_units', 0.25)
            w_buildings = get_module_config('leaderboard', 'perf_weight_buildings', 0.15)
            w_survival = get_module_config('leaderboard', 'perf_weight_survival', 0.25)
            performance_score = (
                w_regions * _safe_ratio(row["owned_regions"], max_regions)
                + w_units * _safe_ratio(row["total_units"], max_units)
                + w_buildings * _safe_ratio(row["buildings_built"], max_buildings)
                + w_survival * _safe_ratio(survived_ticks, max_survival_ticks)
                + discipline_penalty
            )
            row["performance_score"] = performance_score
            row["base_elo_component"] = k_factor * (placement_total - expected_total)
            raw_changes.append(0.0)  # placeholder, computed below

        if is_ranked:
            # Recompute raw changes only for humans
            human_indices = [i for i, r in enumerate(player_rows) if not r["is_bot"]]
            human_perf = [player_rows[i]["performance_score"] for i in human_indices]
            average_performance = sum(human_perf) / len(human_perf) if human_perf else 0.0

            perf_component_weight = get_module_config('leaderboard', 'performance_component_weight', 0.35)
            for i in human_indices:
                row = player_rows[i]
                performance_component = k_factor * perf_component_weight * (row["performance_score"] - average_performance)
                row["raw_elo_change"] = row["base_elo_component"] + performance_component
                raw_changes[i] = row["raw_elo_change"]

        elo_changes = _balanced_round_elo_changes(raw_changes)

        users_to_update = []
        player_results_to_create = []
        for row, elo_change in zip(player_rows, elo_changes, strict=True):
            # Bots and unranked matches always get 0
            if row["is_bot"] or not is_ranked:
                elo_change = 0

            user = row["match_player"].user
            if elo_change != 0:
                user.elo_rating = int(user.elo_rating) + int(elo_change)
                users_to_update.append(user)

            row["final_elo_change"] = int(elo_change)
            player_results_to_create.append(PlayerResult(
                match_result=result,
                user=user,
                placement=row["placement"],
                regions_conquered=row["owned_regions"],
                units_produced=row["total_units"],
                units_lost=row.get("units_lost", 0),
                buildings_built=row["buildings_built"],
                elo_change=int(elo_change),
            ))

        # Bulk operations: 2 queries instead of up to 16
        if users_to_update:
            from apps.accounts.models import User
            User.objects.bulk_update(users_to_update, ['elo_rating'])
        PlayerResult.objects.bulk_create(player_results_to_create)

        # Send match result notifications to non-bot players
        try:
            from apps.notifications.services import notify_match_result
            for row in player_rows:
                if not row["is_bot"]:
                    notify_match_result(
                        user=row["match_player"].user,
                        placement=row["placement"],
                        elo_change=row.get("final_elo_change", 0),
                        match_id=str(match_id),
                    )
        except Exception as e:
            logger.error("Failed to send match result notifications for match %s: %s", match_id, e)

    logger.info(
        "Match %s finalized immediately: winner=%s, ticks=%d",
        match_id,
        winner_id,
        total_ticks,
    )

    # --- StatTrak increment ---
    try:
        from apps.inventory.models import ItemInstance
        from django.db.models import F

        stattrak_instance_ids = set()

        for mp in match.players.all():
            # Collect instance_ids from deck_snapshot
            if mp.deck_snapshot:
                for iid in mp.deck_snapshot.get('instance_ids', []):
                    stattrak_instance_ids.add(iid)

            # Collect instance_ids from cosmetic_snapshot
            if mp.cosmetic_snapshot:
                for slot, val in mp.cosmetic_snapshot.items():
                    if isinstance(val, dict) and val.get('instance_id'):
                        stattrak_instance_ids.add(val['instance_id'])

        if stattrak_instance_ids:
            # Build per-player stats map keyed by user_id string
            player_stats = {}
            for row in player_rows:
                pid = row['pid']
                player_stats[pid] = {
                    'regions': row.get('owned_regions', 0),
                    'units': row.get('total_units', 0),
                }

            # Increment matches counter on all StatTrak instances that participated
            ItemInstance.objects.filter(
                id__in=stattrak_instance_ids,
                stattrak=True,
            ).update(
                stattrak_matches=F('stattrak_matches') + 1,
            )

            # Per-player updates for region kills and units produced
            for mp in match.players.all():
                pid = str(mp.user_id)
                stats = player_stats.get(pid, {})

                mp_instance_ids = set()
                if mp.deck_snapshot:
                    for iid in mp.deck_snapshot.get('instance_ids', []):
                        mp_instance_ids.add(iid)
                if mp.cosmetic_snapshot:
                    for slot, val in mp.cosmetic_snapshot.items():
                        if isinstance(val, dict) and val.get('instance_id'):
                            mp_instance_ids.add(val['instance_id'])

                if mp_instance_ids:
                    ItemInstance.objects.filter(
                        id__in=mp_instance_ids,
                        stattrak=True,
                    ).update(
                        stattrak_kills=F('stattrak_kills') + stats.get('regions', 0),
                        stattrak_units_produced=F('stattrak_units_produced') + stats.get('units', 0),
                    )
    except Exception as e:
        logger.error("Failed to update StatTrak for match %s: %s", match_id, e)

    # Generate post-match item drops
    try:
        from apps.inventory.tasks import generate_match_drops
        generate_match_drops(match_id)
    except Exception as e:
        logger.error("Failed to generate match drops for %s: %s", match_id, e)

    # Dispatch webhook events
    try:
        from apps.developers.tasks import dispatch_webhook_event

        dispatch_webhook_event('match.finished', {
            'match_id': str(match_id),
            'winner_id': str(winner_id) if winner_id else None,
        })

        for row in player_rows:
            if not row["is_bot"] and row.get("final_elo_change", 0) != 0:
                user = row["match_player"].user
                dispatch_webhook_event('player.elo_changed', {
                    'user_id': str(user.id),
                    'username': user.username,
                    'elo_change': row["final_elo_change"],
                    'new_elo': user.elo_rating,
                    'match_id': str(match_id),
                })
    except Exception as e:
        logger.error(f"Failed to dispatch webhook events: {e}")

    # ── Prometheus metrics ───────────────────────────────────────────
    try:
        game_mode = (match.settings_snapshot or {}).get("game_mode", "default")
        game_metrics.matches_finished_total.labels(game_mode=game_mode).inc()
        game_metrics.match_duration_seconds.observe(duration)

        for row in player_rows:
            if row["is_bot"]:
                continue
            elo_delta = row.get("final_elo_change", 0)
            result_label = "win" if row["pid"] == winner_id else "loss"
            game_metrics.elo_change.labels(result=result_label).observe(elo_delta)

            reason = row.get("eliminated_reason", "")
            if reason:
                game_metrics.player_eliminations_total.labels(reason=reason).inc()
    except Exception as e:
        logger.debug("Failed to emit prometheus metrics: %s", e)


@shared_task
def save_game_snapshot(match_id: str, tick: int, state_data: dict):
    """Save a periodic game state snapshot to PostgreSQL."""
    from apps.game.models import GameStateSnapshot

    GameStateSnapshot.objects.update_or_create(
        match_id=match_id,
        tick=tick,
        defaults={"state_data": state_data},
    )
    logger.info("Snapshot saved for match %s at tick %d", match_id, tick)


@shared_task
def finalize_match_results(
    match_id: str,
    winner_id: str | None,
    total_ticks: int,
    final_state: dict,
):
    """Celery wrapper for match finalization."""
    finalize_match_results_sync(match_id, winner_id, total_ticks, final_state)


@shared_task
def cleanup_redis_game_state(match_id: str):
    """Remove all Redis keys for a finished match using known suffixes."""
    r = redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_GAME_DB,
    )
    known_suffixes = [
        "meta", "players", "regions", "actions",
        "buildings_queue", "unit_queue", "transit_queue",
        "active_effects", "loop_lock", "init_lock",
        "capital_timer_lock", "capital_finalize_lock",
        "cancel_requested",
    ]
    keys = [f"game:{match_id}:{suffix}" for suffix in known_suffixes]
    deleted = r.delete(*keys)
    r.close()
    logger.info("Cleaned up %d Redis keys for match %s", deleted, match_id)


@shared_task
def cleanup_stale_matches():
    """Cancel matches stuck in non-terminal states beyond safe time limits."""
    from datetime import timedelta

    from django.utils import timezone

    from apps.game_config.models import GameSettings
    from apps.matchmaking.models import Match

    settings_obj = GameSettings.get()
    now = timezone.now()
    match_limit_minutes = int(getattr(settings_obj, "match_duration_limit_minutes", 0) or 0)
    capital_selection_seconds = int(getattr(settings_obj, "capital_selection_time_seconds", 30) or 30)

    selecting_timeout = timedelta(seconds=max(300, capital_selection_seconds + 300))
    in_progress_timeout = (
        timedelta(minutes=max(15, match_limit_minutes + 15))
        if match_limit_minutes > 0
        else timedelta(hours=2)
    )

    # Push time filter to DB — only fetch matches that are actually stale
    selecting_cutoff = now - selecting_timeout
    in_progress_cutoff = now - in_progress_timeout

    from django.db.models import Q, F, functions as db_fn

    stale_matches = Match.objects.filter(
        Q(status=Match.Status.SELECTING, created_at__lt=selecting_cutoff) |
        Q(status=Match.Status.IN_PROGRESS, started_at__lt=in_progress_cutoff)
    )

    count = 0
    for match in stale_matches:
        match.status = Match.Status.CANCELLED
        match.finished_at = now
        match.winner_id = None
        match.save(update_fields=["status", "finished_at", "winner"])
        match.players.filter(is_alive=True).update(is_alive=False, eliminated_at=now)
        cleanup_redis_game_state.delay(str(match.id))
        count += 1

    if count:
        logger.info("Cleaned up %d stale matches", count)


@shared_task
def cleanup_stale_queue_entries():
    """Remove matchmaking queue entries older than 30 minutes."""
    from datetime import timedelta

    from django.utils import timezone

    from apps.matchmaking.models import MatchQueue

    stale_queue_minutes = get_module_config('matchmaking', 'stale_queue_cleanup_minutes', 30)
    cutoff = timezone.now() - timedelta(minutes=stale_queue_minutes)
    deleted, _ = MatchQueue.objects.filter(joined_at__lt=cutoff).delete()
    if deleted:
        logger.info("Cleaned up %d stale queue entries", deleted)
