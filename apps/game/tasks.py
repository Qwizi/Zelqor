import logging
from decimal import ROUND_HALF_UP, Decimal
from math import isclose

from celery import shared_task
from django.conf import settings
from django.db import transaction

import redis
from apps.game_config.modules import get_module_config

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

    residuals = [(index, raw_changes[index] - rounded[index]) for index in range(len(raw_changes))]
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


def _award_match_xp(player_rows: list[dict], winner_id: str | None) -> None:
    """Award XP to all human players after a match and check for account level-ups.

    Winner receives 50 XP base; all others receive 20 XP base.
    After awarding, if the user's accumulated XP meets the next AccountLevel
    threshold the user's level field is bumped accordingly.
    """
    from apps.accounts.models import AccountLevel, User

    users_xp_update: list[User] = []

    for row in player_rows:
        if row["is_bot"]:
            continue

        user = row["match_player"].user
        xp_gain = 50 if row["pid"] == winner_id else 20
        user.experience = (user.experience or 0) + xp_gain

        # Resolve highest level whose XP threshold is met
        new_level = (
            AccountLevel.objects.filter(
                experience_required__lte=user.experience,
            )
            .order_by("-level")
            .values_list("level", flat=True)
            .first()
        )
        if new_level is not None and new_level > (user.level or 1):
            user.level = new_level

        users_xp_update.append(user)

    if users_xp_update:
        User.objects.bulk_update(users_xp_update, ["experience", "level"])

    # Dispatch clan XP awards outside the DB loop (fire-and-forget Celery tasks)
    for row in player_rows:
        if row["is_bot"]:
            continue
        xp_gain = 50 if row["pid"] == winner_id else 20
        try:
            from apps.clans.tasks import award_clan_xp

            award_clan_xp.delay(row["pid"], xp_gain)
        except Exception as e:
            logger.error(
                "Failed to dispatch award_clan_xp for player %s: %s",
                row["pid"],
                e,
            )


def _build_player_rows(match, players_data: dict, total_ticks: int, winner_id: str | None) -> list[dict]:
    """Build the player_rows list from match players and final state data."""
    player_rows = []
    for mp in match.players.select_related("user").all():
        pid = str(mp.user_id)
        player_info = players_data.get(pid, {})

        owned_regions = int(player_info.get("total_regions_conquered", 0))
        total_units = int(player_info.get("total_units_produced", 0))
        cumulative_units_lost = int(player_info.get("total_units_lost", 0))
        buildings_count = int(player_info.get("total_buildings_built", 0))

        player_rows.append(
            {
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
            }
        )

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

    return player_rows


def _compute_elo_changes(player_rows: list[dict], total_ticks: int, k_factor: int, is_ranked: bool) -> list[int]:
    """Compute balanced ELO changes for all players."""
    max_regions = max((row["owned_regions"] for row in player_rows), default=0)
    max_units = max((row["total_units"] for row in player_rows), default=0)
    max_buildings = max((row["buildings_built"] for row in player_rows), default=0)
    max_survival_ticks = max(total_ticks, 1)

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
            expected_score = 1 / (1 + 10 ** ((opponent["rating_before"] - row["rating_before"]) / 400))
            placement_total += actual_score
            expected_total += expected_score

        survived_ticks = row["eliminated_tick"] or total_ticks
        row["survived_ticks"] = survived_ticks
        discipline_penalty = 0.0
        if row["eliminated_reason"] == "left_match":
            discipline_penalty = get_module_config("leaderboard", "discipline_penalty_left_match", -0.2)
        elif row["eliminated_reason"] == "disconnect_timeout":
            discipline_penalty = get_module_config("leaderboard", "discipline_penalty_disconnect", -0.12)

        w_regions = get_module_config("leaderboard", "perf_weight_regions", 0.35)
        w_units = get_module_config("leaderboard", "perf_weight_units", 0.25)
        w_buildings = get_module_config("leaderboard", "perf_weight_buildings", 0.15)
        w_survival = get_module_config("leaderboard", "perf_weight_survival", 0.25)
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

        perf_component_weight = get_module_config("leaderboard", "performance_component_weight", 0.35)
        for i in human_indices:
            row = player_rows[i]
            performance_component = k_factor * perf_component_weight * (row["performance_score"] - average_performance)
            row["raw_elo_change"] = row["base_elo_component"] + performance_component
            raw_changes[i] = row["raw_elo_change"]

    return _balanced_round_elo_changes(raw_changes)


def _build_outbox_payload(
    match_id: str,
    winner_id: str | None,
    total_ticks: int,
    player_rows: list[dict],
) -> dict:
    """Build the serialisable outbox payload (no ORM objects — IDs only)."""
    player_summaries = []
    for row in player_rows:
        player_summaries.append(
            {
                "user_id": row["pid"],
                "is_bot": row["is_bot"],
                "placement": row["placement"],
                "final_elo_change": row.get("final_elo_change", 0),
                "owned_regions": row["owned_regions"],
                "total_units": row["total_units"],
                "units_lost": row.get("units_lost", 0),
                "buildings_built": row["buildings_built"],
                "is_alive": row["is_alive"],
                "eliminated_reason": row.get("eliminated_reason", ""),
                # deck/cosmetic snapshots for StatTrak handler
                "deck_snapshot": row["match_player"].deck_snapshot,
                "cosmetic_snapshot": row["match_player"].cosmetic_snapshot,
            }
        )
    return {
        "match_id": str(match_id),
        "winner_id": str(winner_id) if winner_id else None,
        "total_ticks": total_ticks,
        "players": player_summaries,
    }


def finalize_match_results_sync(
    match_id: str,
    winner_id: str | None,
    total_ticks: int,
    final_state: dict,
):
    """Persist match results immediately and idempotently.

    When OUTBOX_ENABLED=True (the default) side-effect work (StatTrak, drops,
    webhooks, clan-war resolution, notifications) is deferred via OutboxEvent
    records written atomically with the core transaction.  A periodic Celery
    task (publish_outbox_events) then picks up and dispatches those events.

    When OUTBOX_ENABLED=False the legacy synchronous behaviour is preserved.
    """
    from django.utils import timezone

    from apps.game.models import GameStateSnapshot, MatchResult, OutboxEvent, PlayerResult
    from apps.game_config.models import GameSettings
    from apps.matchmaking.models import Match

    outbox_enabled = getattr(settings, "OUTBOX_ENABLED", True)

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

        players_data = final_state.get("players", {})
        snapshot_k = match.settings_snapshot.get("elo_k_factor") if match.settings_snapshot else None
        if snapshot_k is not None:
            k_factor = max(1, int(snapshot_k))
        else:
            settings_obj = GameSettings.get()
            k_factor = max(1, int(settings_obj.elo_k_factor))

        player_rows = _build_player_rows(match, players_data, total_ticks, winner_id)

        # Determine if match is ranked:
        # 1) Enough human players, AND
        # 2) Match ran on an official (verified) server.
        min_human_players = get_module_config("leaderboard", "min_human_players_for_ranked", 2)
        human_rows = [r for r in player_rows if not r["is_bot"]]
        server_is_official = getattr(match.server, "is_verified", False)
        is_ranked = len(human_rows) >= min_human_players and server_is_official

        elo_changes = _compute_elo_changes(player_rows, total_ticks, k_factor, is_ranked)

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
            player_results_to_create.append(
                PlayerResult(
                    match_result=result,
                    user=user,
                    placement=row["placement"],
                    regions_conquered=row["owned_regions"],
                    units_produced=row["total_units"],
                    units_lost=row.get("units_lost", 0),
                    buildings_built=row["buildings_built"],
                    elo_change=int(elo_change),
                )
            )

        # Bulk operations: 2 queries instead of up to 16
        if users_to_update:
            from apps.accounts.models import User

            User.objects.bulk_update(users_to_update, ["elo_rating"])
        PlayerResult.objects.bulk_create(player_results_to_create)

        # Award XP to non-bot players and check for level-ups
        _award_match_xp(player_rows, winner_id)

        if outbox_enabled:
            # Write outbox events atomically — side effects are handled by handlers
            outbox_payload = _build_outbox_payload(match_id, winner_id, total_ticks, player_rows)
            OutboxEvent.objects.bulk_create(
                [
                    OutboxEvent(
                        aggregate_type="match",
                        aggregate_id=str(match_id),
                        event_type="match.finalized",
                        payload=outbox_payload,
                    ),
                    OutboxEvent(
                        aggregate_type="match",
                        aggregate_id=str(match_id),
                        event_type="match.notifications",
                        payload=outbox_payload,
                    ),
                    OutboxEvent(
                        aggregate_type="match",
                        aggregate_id=str(match_id),
                        event_type="match.webhooks",
                        payload=outbox_payload,
                    ),
                    OutboxEvent(
                        aggregate_type="match",
                        aggregate_id=str(match_id),
                        event_type="match.clan_war",
                        payload={
                            "match_id": str(match_id),
                            "winner_id": str(winner_id) if winner_id else None,
                        },
                    ),
                ]
            )
        else:
            # OUTBOX: legacy synchronous side effects below (kept for backward compatibility)

            # Send match result notifications to non-bot players
            # OUTBOX: moved to handle_match_notifications
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

    if not outbox_enabled:
        # OUTBOX: legacy synchronous side effects — StatTrak, drops, webhooks, clan war

        # --- StatTrak increment ---
        # OUTBOX: moved to handle_match_finalized
        try:
            from django.db.models import F

            from apps.inventory.models import ItemInstance

            stattrak_instance_ids = set()

            for mp in match.players.all():
                # Collect instance_ids from deck_snapshot
                if mp.deck_snapshot:
                    for iid in mp.deck_snapshot.get("instance_ids", []):
                        stattrak_instance_ids.add(iid)

                # Collect instance_ids from cosmetic_snapshot
                if mp.cosmetic_snapshot:
                    for _slot, val in mp.cosmetic_snapshot.items():
                        if isinstance(val, dict) and val.get("instance_id"):
                            stattrak_instance_ids.add(val["instance_id"])

            if stattrak_instance_ids:
                # Build per-player stats map keyed by user_id string
                player_stats = {}
                for row in player_rows:
                    pid = row["pid"]
                    player_stats[pid] = {
                        "regions": row.get("owned_regions", 0),
                        "units": row.get("total_units", 0),
                    }

                # Increment matches counter on all StatTrak instances that participated
                ItemInstance.objects.filter(
                    id__in=stattrak_instance_ids,
                    stattrak=True,
                ).update(
                    stattrak_matches=F("stattrak_matches") + 1,
                )

                # Per-player updates for region kills and units produced
                for mp in match.players.all():
                    pid = str(mp.user_id)
                    stats = player_stats.get(pid, {})

                    mp_instance_ids = set()
                    if mp.deck_snapshot:
                        for iid in mp.deck_snapshot.get("instance_ids", []):
                            mp_instance_ids.add(iid)
                    if mp.cosmetic_snapshot:
                        for _slot, val in mp.cosmetic_snapshot.items():
                            if isinstance(val, dict) and val.get("instance_id"):
                                mp_instance_ids.add(val["instance_id"])

                    if mp_instance_ids:
                        ItemInstance.objects.filter(
                            id__in=mp_instance_ids,
                            stattrak=True,
                        ).update(
                            stattrak_kills=F("stattrak_kills") + stats.get("regions", 0),
                            stattrak_units_produced=F("stattrak_units_produced") + stats.get("units", 0),
                        )
        except Exception as e:
            logger.error("Failed to update StatTrak for match %s: %s", match_id, e)

        # Generate post-match item drops
        # OUTBOX: moved to handle_match_finalized
        try:
            from apps.inventory.tasks import generate_match_drops

            generate_match_drops(match_id)
        except Exception as e:
            logger.error("Failed to generate match drops for %s: %s", match_id, e)

        # Dispatch webhook events
        # OUTBOX: moved to handle_match_webhooks
        try:
            from apps.developers.tasks import dispatch_webhook_event

            dispatch_webhook_event(
                "match.finished",
                {
                    "match_id": str(match_id),
                    "winner_id": str(winner_id) if winner_id else None,
                },
            )

            for row in player_rows:
                if not row["is_bot"] and row.get("final_elo_change", 0) != 0:
                    user = row["match_player"].user
                    dispatch_webhook_event(
                        "player.elo_changed",
                        {
                            "user_id": str(user.id),
                            "username": user.username,
                            "elo_change": row["final_elo_change"],
                            "new_elo": user.elo_rating,
                            "match_id": str(match_id),
                        },
                    )
        except Exception as e:
            logger.error("Failed to dispatch webhook events: %s", e)

        # --- Clan war resolution ---
        # OUTBOX: moved to handle_clan_war_resolution
        try:
            from apps.clans.models import ClanWar

            clan_war = (
                ClanWar.objects.filter(
                    match_id=match_id,
                    status=ClanWar.Status.IN_PROGRESS,
                )
                .select_related("challenger", "defender")
                .first()
            )

            if clan_war:
                _resolve_clan_war(clan_war, match_id, winner_id)
        except Exception as e:
            logger.error("Failed to resolve clan war for match %s: %s", match_id, e)


# ---------------------------------------------------------------------------
# Outbox handler tasks — invoked by publish_outbox_events
# ---------------------------------------------------------------------------


@shared_task(bind=True, max_retries=5, default_retry_delay=10)
def handle_match_finalized(self, payload: dict):
    """Handle StatTrak updates and item drop generation after match finalization."""
    match_id = payload["match_id"]
    players = payload.get("players", [])

    # --- StatTrak increment ---
    try:
        from django.db.models import F

        from apps.inventory.models import ItemInstance

        stattrak_instance_ids = set()
        player_stats: dict[str, dict] = {}

        for p in players:
            pid = p["user_id"]
            player_stats[pid] = {
                "regions": p.get("owned_regions", 0),
                "units": p.get("total_units", 0),
            }
            deck_snapshot = p.get("deck_snapshot") or {}
            cosmetic_snapshot = p.get("cosmetic_snapshot") or {}

            for iid in deck_snapshot.get("instance_ids", []):
                stattrak_instance_ids.add(iid)
            for _slot, val in cosmetic_snapshot.items():
                if isinstance(val, dict) and val.get("instance_id"):
                    stattrak_instance_ids.add(val["instance_id"])

        if stattrak_instance_ids:
            # Increment matches counter on all participating StatTrak instances
            ItemInstance.objects.filter(
                id__in=stattrak_instance_ids,
                stattrak=True,
            ).update(stattrak_matches=F("stattrak_matches") + 1)

            # Per-player region/unit updates
            for p in players:
                pid = p["user_id"]
                stats = player_stats.get(pid, {})

                mp_instance_ids: set = set()
                deck_snapshot = p.get("deck_snapshot") or {}
                cosmetic_snapshot = p.get("cosmetic_snapshot") or {}
                for iid in deck_snapshot.get("instance_ids", []):
                    mp_instance_ids.add(iid)
                for _slot, val in cosmetic_snapshot.items():
                    if isinstance(val, dict) and val.get("instance_id"):
                        mp_instance_ids.add(val["instance_id"])

                if mp_instance_ids:
                    ItemInstance.objects.filter(
                        id__in=mp_instance_ids,
                        stattrak=True,
                    ).update(
                        stattrak_kills=F("stattrak_kills") + stats.get("regions", 0),
                        stattrak_units_produced=F("stattrak_units_produced") + stats.get("units", 0),
                    )
    except Exception as e:
        logger.error("handle_match_finalized: StatTrak failed for match %s: %s", match_id, e)
        raise self.retry(exc=e) from e

    # Generate post-match item drops
    try:
        from apps.inventory.tasks import generate_match_drops

        generate_match_drops(match_id)
    except Exception as e:
        logger.error("handle_match_finalized: drop generation failed for match %s: %s", match_id, e)
        raise self.retry(exc=e) from e

    logger.info("handle_match_finalized: completed for match %s", match_id)


@shared_task(bind=True, max_retries=5, default_retry_delay=10)
def handle_match_notifications(self, payload: dict):
    """Send match result notifications to all human players."""
    match_id = payload["match_id"]
    players = payload.get("players", [])

    try:
        from apps.accounts.models import User
        from apps.notifications.services import notify_match_result

        user_ids = [p["user_id"] for p in players if not p["is_bot"]]
        user_map = {str(u.id): u for u in User.objects.filter(id__in=user_ids)}

        for p in players:
            if p["is_bot"]:
                continue
            user = user_map.get(p["user_id"])
            if user is None:
                continue
            notify_match_result(
                user=user,
                placement=p["placement"],
                elo_change=p.get("final_elo_change", 0),
                match_id=str(match_id),
            )
    except Exception as e:
        logger.error("handle_match_notifications: failed for match %s: %s", match_id, e)
        raise self.retry(exc=e) from e

    logger.info("handle_match_notifications: completed for match %s", match_id)


@shared_task(bind=True, max_retries=5, default_retry_delay=10)
def handle_match_webhooks(self, payload: dict):
    """Dispatch match.finished and player.elo_changed webhook events."""
    match_id = payload["match_id"]
    winner_id = payload.get("winner_id")
    players = payload.get("players", [])

    try:
        from apps.developers.tasks import dispatch_webhook_event

        dispatch_webhook_event(
            "match.finished",
            {
                "match_id": str(match_id),
                "winner_id": str(winner_id) if winner_id else None,
            },
        )

        from apps.accounts.models import User

        user_ids = [p["user_id"] for p in players if not p["is_bot"] and p.get("final_elo_change", 0) != 0]
        user_map = {str(u.id): u for u in User.objects.filter(id__in=user_ids)}

        for p in players:
            if p["is_bot"]:
                continue
            elo_change = p.get("final_elo_change", 0)
            if elo_change == 0:
                continue
            user = user_map.get(p["user_id"])
            if user is None:
                continue
            dispatch_webhook_event(
                "player.elo_changed",
                {
                    "user_id": str(user.id),
                    "username": user.username,
                    "elo_change": elo_change,
                    "new_elo": user.elo_rating,
                    "match_id": str(match_id),
                },
            )
    except Exception as e:
        logger.error("handle_match_webhooks: failed for match %s: %s", match_id, e)
        raise self.retry(exc=e) from e

    logger.info("handle_match_webhooks: completed for match %s", match_id)


@shared_task(bind=True, max_retries=5, default_retry_delay=10)
def handle_clan_war_resolution(self, payload: dict):
    """Resolve a clan war if the finished match was a war match."""
    match_id = payload["match_id"]
    winner_id = payload.get("winner_id")

    try:
        from apps.clans.models import ClanWar

        clan_war = (
            ClanWar.objects.filter(
                match_id=match_id,
                status=ClanWar.Status.IN_PROGRESS,
            )
            .select_related("challenger", "defender")
            .first()
        )

        if clan_war:
            _resolve_clan_war(clan_war, match_id, winner_id)
        else:
            logger.debug("handle_clan_war_resolution: no in-progress clan war for match %s", match_id)
    except Exception as e:
        logger.error("handle_clan_war_resolution: failed for match %s: %s", match_id, e)
        raise self.retry(exc=e) from e

    logger.info("handle_clan_war_resolution: completed for match %s", match_id)


# Mapping of event_type → handler task
_OUTBOX_HANDLERS: dict[str, "shared_task"] = {}


def _get_outbox_handlers() -> dict:
    """Lazily build the event_type → handler task map to avoid import-time issues."""
    global _OUTBOX_HANDLERS
    if not _OUTBOX_HANDLERS:
        _OUTBOX_HANDLERS = {
            "match.finalized": handle_match_finalized,
            "match.notifications": handle_match_notifications,
            "match.webhooks": handle_match_webhooks,
            "match.clan_war": handle_clan_war_resolution,
        }
    return _OUTBOX_HANDLERS


@shared_task
def publish_outbox_events():
    """Periodic task: pick up unpublished OutboxEvents and dispatch handler tasks.

    Uses SELECT FOR UPDATE SKIP LOCKED so multiple Celery workers do not race
    on the same batch.  Marks events published before dispatching so that a
    crash in the handler does not re-dispatch — handlers themselves carry
    retry logic.
    """
    from django.utils import timezone

    from apps.game.models import OutboxEvent

    handlers = _get_outbox_handlers()

    with transaction.atomic():
        events = list(
            OutboxEvent.objects.select_for_update(skip_locked=True).filter(published=False).order_by("created_at")[:100]
        )

        if not events:
            return

        now = timezone.now()
        for event in events:
            event.published = True
            event.published_at = now
        OutboxEvent.objects.bulk_update(events, ["published", "published_at"])

    # Dispatch outside the transaction so the commit is visible before tasks run
    for event in events:
        handler = handlers.get(event.event_type)
        if handler is None:
            logger.warning("publish_outbox_events: no handler for event_type=%s", event.event_type)
            continue
        try:
            handler.delay(event.payload)
        except Exception as e:
            logger.error(
                "publish_outbox_events: failed to dispatch %s for %s:%s — %s",
                event.event_type,
                event.aggregate_type,
                event.aggregate_id,
                e,
            )

    logger.info("publish_outbox_events: dispatched %d events", len(events))


def _resolve_clan_war(clan_war, match_id: str, winner_id: str | None) -> None:
    """Determine the winning clan for a clan war and kick off ELO calculation."""
    from django.utils import timezone

    from apps.clans.models import ClanWar, ClanWarParticipant
    from apps.clans.tasks import calculate_clan_war_elo
    from apps.matchmaking.models import MatchPlayer

    winning_clan_id = None

    if winner_id:
        # Primary: look up the participant record for the winning user
        participant = (
            ClanWarParticipant.objects.filter(
                war=clan_war,
                user_id=winner_id,
            )
            .values_list("clan_id", flat=True)
            .first()
        )
        if participant:
            winning_clan_id = participant
        else:
            # Fallback: use team_label on MatchPlayer to map back to a clan
            mp = (
                MatchPlayer.objects.filter(
                    match_id=match_id,
                    user_id=winner_id,
                )
                .values_list("team_label", flat=True)
                .first()
            )
            if mp == "challenger":
                winning_clan_id = clan_war.challenger_id
            elif mp == "defender":
                winning_clan_id = clan_war.defender_id

    if winning_clan_id:
        clan_war.status = ClanWar.Status.FINISHED
        clan_war.finished_at = timezone.now()
        clan_war.winner_id = winning_clan_id
        clan_war.save(update_fields=["status", "finished_at", "winner"])
        calculate_clan_war_elo.delay(str(clan_war.pk))
        logger.info(
            "Clan war %s resolved: winner clan %s (match %s)",
            clan_war.pk,
            winning_clan_id,
            match_id,
        )
    else:
        # Draw or no winner — refund wagers to both clans
        from apps.clans.models import Clan

        clan_war.status = ClanWar.Status.FINISHED
        clan_war.finished_at = timezone.now()
        clan_war.save(update_fields=["status", "finished_at"])

        if clan_war.wager_gold > 0:
            from django.db.models import F

            with transaction.atomic():
                for clan_pk in (clan_war.challenger_id, clan_war.defender_id):
                    Clan.objects.filter(pk=clan_pk).update(
                        treasury_gold=F("treasury_gold") + clan_war.wager_gold,
                    )
            logger.info(
                "Clan war %s ended as draw — refunded %d gold to each clan",
                clan_war.pk,
                clan_war.wager_gold,
            )


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
        "meta",
        "players",
        "regions",
        "actions",
        "buildings_queue",
        "unit_queue",
        "transit_queue",
        "active_effects",
        "loop_lock",
        "init_lock",
        "capital_timer_lock",
        "capital_finalize_lock",
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
        timedelta(minutes=max(15, match_limit_minutes + 15)) if match_limit_minutes > 0 else timedelta(hours=2)
    )

    # Push time filter to DB — only fetch matches that are actually stale
    selecting_cutoff = now - selecting_timeout
    in_progress_cutoff = now - in_progress_timeout

    from django.db.models import Q

    stale_matches = Match.objects.filter(
        Q(status=Match.Status.SELECTING, created_at__lt=selecting_cutoff)
        | Q(status=Match.Status.IN_PROGRESS, started_at__lt=in_progress_cutoff)
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

    stale_queue_minutes = get_module_config("matchmaking", "stale_queue_cleanup_minutes", 30)
    cutoff = timezone.now() - timedelta(minutes=stale_queue_minutes)
    deleted, _ = MatchQueue.objects.filter(joined_at__lt=cutoff).delete()
    if deleted:
        logger.info("Cleaned up %d stale queue entries", deleted)
