import logging
from decimal import Decimal, ROUND_HALF_UP
from math import isclose

import redis
from celery import shared_task
from django.conf import settings
from django.db import transaction

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

        # Determine if match is ranked (need at least 2 human players)
        human_rows = [r for r in player_rows if not r["is_bot"]]
        is_ranked = len(human_rows) >= 2

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
                discipline_penalty = -0.2
            elif row["eliminated_reason"] == "disconnect_timeout":
                discipline_penalty = -0.12

            performance_score = (
                0.35 * _safe_ratio(row["owned_regions"], max_regions)
                + 0.25 * _safe_ratio(row["total_units"], max_units)
                + 0.15 * _safe_ratio(row["buildings_built"], max_buildings)
                + 0.25 * _safe_ratio(survived_ticks, max_survival_ticks)
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

            for i in human_indices:
                row = player_rows[i]
                performance_component = k_factor * 0.35 * (row["performance_score"] - average_performance)
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

    logger.info(
        "Match %s finalized immediately: winner=%s, ticks=%d",
        match_id,
        winner_id,
        total_ticks,
    )

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

    # Process engagement rewards
    try:
        from apps.engagement.tasks import process_match_engagement
        process_match_engagement.delay(str(match_id))
    except Exception as e:
        logger.error("Failed to process engagement for %s: %s", match_id, e)


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

    cutoff = timezone.now() - timedelta(minutes=30)
    deleted, _ = MatchQueue.objects.filter(joined_at__lt=cutoff).delete()
    if deleted:
        logger.info("Cleaned up %d stale queue entries", deleted)
