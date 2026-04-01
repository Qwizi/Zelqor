import logging

from ninja import Schema
from ninja_extra import ControllerBase, api_controller, route
from pydantic import Field, field_validator

import redis
from apps.internal_auth import check_internal_secret

logger = logging.getLogger(__name__)


# --- Schemas ---


class SnapshotRequest(Schema):
    match_id: str
    tick: int
    state_data: dict


class FinalizeRequest(Schema):
    match_id: str
    winner_id: str | None = None
    total_ticks: int
    final_state: dict


class CleanupRequest(Schema):
    match_id: str


class ServerStatusUpdate(Schema):
    status: str  # "online", "offline", "maintenance"


class AssignServerRequest(Schema):
    server_id: str


class StatusUpdateRequest(Schema):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        # Import here to avoid circular imports at module load time.
        from apps.matchmaking.models import Match

        valid = {choice.value for choice in Match.Status}
        if v not in valid:
            raise ValueError(f"Invalid status. Must be one of: {sorted(valid)}")
        return v


class AliveUpdateRequest(Schema):
    is_alive: bool


class CancelMatchRequest(Schema):
    match_id: str


class ReportViolationRequest(Schema):
    match_id: str
    player_id: str
    violation_kind: str
    severity: str
    detail: str
    tick: int


class BanPlayerRequest(Schema):
    player_id: str
    reason: str


class CompensateRequest(Schema):
    match_id: str
    player_ids: list[str] = Field(default_factory=list)


# --- Controller ---


@api_controller("/internal", tags=["internal"])
class GameInternalController(ControllerBase):
    """Internal API for the Rust gateway — game-related endpoints."""

    @route.post("/game/snapshot/")
    def save_snapshot(self, request, body: SnapshotRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game.models import GameStateSnapshot

        GameStateSnapshot.objects.update_or_create(
            match_id=body.match_id,
            tick=body.tick,
            defaults={"state_data": body.state_data},
        )
        return {"ok": True}

    @route.get("/game/latest-snapshot/{match_id}/")
    def get_latest_snapshot(self, request, match_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game.models import GameStateSnapshot

        snapshot = GameStateSnapshot.objects.filter(match_id=match_id).order_by("-tick").first()
        if snapshot:
            return {"tick": snapshot.tick, "state_data": snapshot.state_data}
        return {"tick": None, "state_data": None}

    @route.post("/game/finalize/")
    def finalize_match(self, request, body: FinalizeRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game.tasks import finalize_match_results_sync

        finalize_match_results_sync(
            body.match_id,
            body.winner_id,
            body.total_ticks,
            body.final_state,
        )
        return {"ok": True}

    @route.post("/game/cleanup/")
    def cleanup_match(self, request, body: CleanupRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game.tasks import cleanup_redis_game_state

        cleanup_redis_game_state.delay(body.match_id)
        return {"ok": True}

    @route.get("/users/{user_id}/")
    def get_user(self, request, user_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.accounts.models import User

        try:
            user = User.objects.get(id=user_id)
            return {
                "id": str(user.id),
                "username": user.username,
                "elo_rating": user.elo_rating,
                "is_active": not user.is_banned,
            }
        except User.DoesNotExist:
            return self.create_response({"error": "User not found"}, status_code=404)

    @route.get("/matches/{match_id}/verify-player/{user_id}/")
    def verify_player(self, request, match_id: str, user_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.accounts.models import User
        from apps.matchmaking.models import MatchPlayer

        is_member = MatchPlayer.objects.filter(match_id=match_id, user_id=user_id).exists()
        try:
            is_banned = User.objects.filter(id=user_id).values_list("is_banned", flat=True).get()
        except User.DoesNotExist:
            is_banned = True
        return {"is_member": is_member, "is_active": not is_banned}

    @route.get("/matches/{match_id}/verify-spectator/{user_id}/")
    def verify_spectator(self, request, match_id: str, user_id: str):
        """Verify if a user can spectate a match. Only friends of match players can spectate."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.db.models import Q

        from apps.accounts.models import Friendship, User
        from apps.matchmaking.models import Match

        try:
            is_banned = User.objects.filter(id=user_id).values_list("is_banned", flat=True).get()
        except User.DoesNotExist:
            return {"is_member": False, "is_active": False}

        if is_banned:
            return {"is_member": False, "is_active": False}

        match = Match.objects.filter(id=match_id).first()
        if not match:
            return {"is_member": False, "is_active": True}

        if match.status not in (Match.Status.SELECTING, Match.Status.IN_PROGRESS):
            return {"is_member": False, "is_active": True}

        # Check if spectator is friends with at least one player in the match
        player_ids = list(match.players.values_list("user_id", flat=True))
        is_friend_of_player = Friendship.objects.filter(
            Q(from_user_id=user_id, to_user_id__in=player_ids) | Q(to_user_id=user_id, from_user_id__in=player_ids),
            status=Friendship.Status.ACCEPTED,
        ).exists()

        if not is_friend_of_player:
            return {"is_member": False, "is_active": True}

        return {"is_member": True, "is_active": True}

    @route.get("/matches/{match_id}/data/")
    def get_match_data(self, request, match_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Match

        try:
            match = Match.objects.prefetch_related("players__user__clan_membership__clan").get(id=match_id)
            return {
                "max_players": match.max_players,
                "is_tutorial": match.is_tutorial,
                "settings_snapshot": match.settings_snapshot,
                "players": [
                    {
                        "user_id": str(p.user.id),
                        "username": p.user.username,
                        "clan_tag": getattr(
                            getattr(getattr(p.user, "clan_membership", None), "clan", None), "tag", None
                        ),
                        "color": p.color,
                        "is_bot": p.user.is_bot,
                        # Deck snapshot fields — consumed at match creation and stored on
                        # MatchPlayer.deck_snapshot.  The Rust gateway reads these to
                        # initialise the Player struct (unlocked_buildings, unlocked_units,
                        # ability_scrolls, active_boosts).
                        "unlocked_buildings": (p.deck_snapshot or {}).get("unlocked_buildings", []),
                        "unlocked_units": (p.deck_snapshot or {}).get("unlocked_units", []),
                        "ability_scrolls": (p.deck_snapshot or {}).get("ability_scrolls", {}),
                        "active_boosts": (p.deck_snapshot or {}).get("active_boosts", []),
                        "ability_levels": (p.deck_snapshot or {}).get("ability_levels", {}),
                        "building_levels": (p.deck_snapshot or {}).get("building_levels", {}),
                        "unit_levels": (p.deck_snapshot or {}).get("unit_levels", {}),
                        "cosmetics": p.cosmetic_snapshot,
                        # Team assignment for team-based modes (null for free-for-all).
                        "team": p.team_label,
                    }
                    for p in match.players.all()
                ],
            }
        except Match.DoesNotExist:
            return self.create_response({"error": "Match not found"}, status_code=404)

    @route.get("/matches/{match_id}/regions/")
    def get_match_regions(self, request, match_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.geo.models import Region
        from apps.matchmaking.models import Match

        try:
            match = Match.objects.select_related("map_config").get(id=match_id)
        except Match.DoesNotExist:
            return self.create_response({"error": "Match not found"}, status_code=404)

        qs = Region.objects.select_related("country")
        if match.map_config and match.map_config.country_codes:
            qs = qs.filter(country__code__in=match.map_config.country_codes)

        return {
            str(r.id): {
                "id": str(r.id),
                "name": r.name,
                "country_code": r.country.code,
                "centroid": [float(r.centroid[0]), float(r.centroid[1])]
                if isinstance(r.centroid, list) and len(r.centroid) == 2
                else None,
                "is_coastal": r.is_coastal,
                "sea_distances": r.sea_distances or [],
            }
            for r in qs
        }

    @route.patch("/matches/{match_id}/status/")
    def update_match_status(self, request, match_id: str, body: StatusUpdateRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Match

        updated = Match.objects.filter(id=match_id).update(status=body.status)
        if not updated:
            return self.create_response({"error": "Match not found"}, status_code=404)
        return {"ok": True}

    @route.patch("/matches/{match_id}/players/{user_id}/alive/")
    def set_player_alive(self, request, match_id: str, user_id: str, body: AliveUpdateRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.utils import timezone

        from apps.matchmaking.models import MatchPlayer

        updates = {"is_alive": body.is_alive}
        if not body.is_alive:
            updates["eliminated_at"] = timezone.now()
        else:
            updates["eliminated_at"] = None

        updated = MatchPlayer.objects.filter(match_id=match_id, user_id=user_id).update(**updates)
        if not updated:
            return self.create_response({"error": "MatchPlayer not found"}, status_code=404)
        return {"ok": True}

    @route.post("/game/cancel-match/")
    def cancel_active_match(self, request, body: CancelMatchRequest):
        """Admin-initiated cancellation of an active match. Sets Redis cancel flag."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.conf import settings

        from apps.matchmaking.models import Match

        match_id = body.match_id
        redis_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_GAME_DB}"
        r = redis.Redis.from_url(redis_url)
        r.set(f"game:{match_id}:cancel_requested", "1", ex=300)

        Match.objects.filter(id=match_id).update(status="cancelled")

        return {"ok": True, "match_id": match_id}

    @route.get("/game/active-matches/")
    def list_active_matches(self, request):
        """List all matches in selecting or in_progress status (for gateway recovery)."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Match

        matches = Match.objects.filter(status__in=[Match.Status.SELECTING, Match.Status.IN_PROGRESS]).values_list(
            "id", flat=True
        )
        return {"match_ids": [str(m) for m in matches]}

    @route.post("/anticheat/report-violation/")
    def report_violation(self, request, body: ReportViolationRequest):
        """Record an anti-cheat violation detected by the Rust gateway."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game.models import AnticheatViolation

        AnticheatViolation.objects.create(
            match_id=body.match_id,
            player_id=body.player_id,
            violation_kind=body.violation_kind,
            severity=body.severity,
            detail=body.detail,
            tick=body.tick,
        )
        logger.info(
            "Anticheat violation recorded: %s (%s) for player %s in match %s at tick %d",
            body.violation_kind,
            body.severity,
            body.player_id,
            body.match_id,
            body.tick,
        )
        return self.create_response({"ok": True}, status_code=201)

    @route.post("/anticheat/ban-player/")
    def ban_player(self, request, body: BanPlayerRequest):
        """Deactivate (ban) a player account flagged by the Rust gateway."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.accounts.models import User

        updated = User.objects.filter(id=body.player_id).update(is_banned=True, banned_reason=body.reason)
        if not updated:
            return self.create_response({"error": "User not found"}, status_code=404)

        logger.warning(
            "Player %s banned via anticheat. Reason: %s",
            body.player_id,
            body.reason,
        )
        return {"ok": True, "player_id": body.player_id}

    @route.post("/anticheat/compensate/")
    def compensate_players(self, request, body: CompensateRequest):
        """Reverse ELO changes for players affected by a cheater in a match."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.db import transaction

        from apps.game.models import PlayerResult

        compensated = []
        errors = []

        with transaction.atomic():
            for player_id in body.player_ids:
                try:
                    pr = PlayerResult.objects.select_related("user").get(
                        match_result__match_id=body.match_id,
                        user_id=player_id,
                    )
                    if pr.elo_change != 0:
                        pr.user.elo_rating -= pr.elo_change
                        pr.user.save(update_fields=["elo_rating"])
                        logger.info(
                            "Compensated player %s: reversed ELO change of %+d (match %s)",
                            player_id,
                            pr.elo_change,
                            body.match_id,
                        )
                    compensated.append(player_id)
                except PlayerResult.DoesNotExist:
                    logger.warning(
                        "No PlayerResult for player %s in match %s — skipping compensation",
                        player_id,
                        body.match_id,
                    )
                    errors.append(player_id)

        return {"ok": True, "compensated": compensated, "not_found": errors}

    @route.get("/regions/neighbors/")
    def get_neighbor_map(self, request):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.core.cache import cache

        cache_key = "internal:neighbor_map"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        from apps.geo.models import Region

        neighbor_map = {}
        for region in Region.objects.prefetch_related("neighbors").all():
            neighbor_map[str(region.id)] = [str(n.id) for n in region.neighbors.all()]
        result = {"neighbors": neighbor_map}
        cache.set(cache_key, result, timeout=86400)  # 24h — immutable after import
        return result

    @route.get("/game/system-modules/")
    def get_system_modules(self, request):
        """Return system module states for the gateway. Cached 60s."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game_config.models import SystemModule

        modules = {}
        for m in SystemModule.objects.filter(affects_gateway=True):
            modules[m.slug] = {
                "enabled": m.enabled,
                "config": m.config,
            }
        return modules

    @route.patch("/server-status/{server_id}/")
    def update_server_status(self, request, server_id: str, body: ServerStatusUpdate):
        """Update a community server's status (called by gateway on connect/disconnect).

        server_id can be either a CommunityServer UUID or a DeveloperApp client_id.
        The gamenode sends its OAuth client_id as server_id.
        """
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.utils import timezone

        from apps.developers.models import CommunityServer

        # Try by app client_id first (gamenode sends its OAuth client_id),
        # then fall back to CommunityServer UUID.
        server = CommunityServer.objects.filter(app__client_id=server_id).first()
        if server is None:
            try:
                import uuid as _uuid

                _uuid.UUID(server_id)  # validate before querying
                server = CommunityServer.objects.filter(id=server_id).first()
            except ValueError:
                pass
        if server is None:
            return self.create_response({"error": "Server not found"}, status_code=404)

        server.status = body.status
        if body.status == "online":
            server.last_heartbeat = timezone.now()
        server.save(update_fields=["status", "last_heartbeat"])
        return {"ok": True}

    @route.get("/server-info/{server_id}/")
    def get_server_info(self, request, server_id: str):
        """Return server metadata for the gateway to resolve is_official."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.developers.models import CommunityServer

        server = CommunityServer.objects.filter(app__client_id=server_id).first()
        if server is None:
            try:
                import uuid as _uuid

                _uuid.UUID(server_id)
                server = CommunityServer.objects.filter(id=server_id).first()
            except ValueError:
                pass
        if server is None:
            return self.create_response({"error": "Server not found"}, status_code=404)

        return {
            "server_uuid": str(server.id),
            "is_verified": server.is_verified,
            "region": server.region,
        }

    @route.patch("/matches/{match_id}/assign-server/")
    def assign_server_to_match(self, request, match_id: str, body: AssignServerRequest):
        """Assign a gamenode server to a match (called by gateway after dispatch)."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.developers.models import CommunityServer
        from apps.matchmaking.models import Match

        try:
            match = Match.objects.get(id=match_id)
        except Match.DoesNotExist:
            return self.create_response({"error": "Match not found"}, status_code=404)

        server = CommunityServer.objects.filter(app__client_id=body.server_id).first()
        if server is None:
            try:
                import uuid as _uuid

                _uuid.UUID(body.server_id)
                server = CommunityServer.objects.filter(id=body.server_id).first()
            except ValueError:
                pass
        if server is None:
            return self.create_response({"error": "Server not found"}, status_code=404)

        match.server = server
        match.save(update_fields=["server"])
        return {"ok": True}

    @route.get("/server-plugins/{server_id}/")
    def get_server_plugins(self, request, server_id: str):
        """Return installed & enabled plugins for a gamenode with WASM download URLs.

        The gamenode calls this at startup to know which plugins to load.
        Each entry contains the manifest info plus the WASM file URL so the
        gamenode can download and cache the binary.
        """
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.developers.models import CommunityServer, ServerPlugin

        # Resolve server by client_id or UUID (same pattern as other endpoints).
        server = CommunityServer.objects.filter(app__client_id=server_id).first()
        if server is None:
            try:
                import uuid as _uuid

                _uuid.UUID(server_id)
                server = CommunityServer.objects.filter(id=server_id).first()
            except ValueError:
                pass
        if server is None:
            return self.create_response({"error": "Server not found"}, status_code=404)

        plugins = (
            ServerPlugin.objects.filter(server=server, is_enabled=True)
            .select_related("plugin", "plugin_version")
            .order_by("priority")
        )

        result = []
        for sp in plugins:
            plugin = sp.plugin
            version = sp.plugin_version

            # Determine WASM file URL — prefer pinned version, fall back to plugin head.
            wasm_file = None
            wasm_hash = ""
            if version and version.wasm_blob:
                wasm_file = version.wasm_blob
                wasm_hash = version.wasm_hash
            elif plugin.wasm_blob:
                wasm_file = plugin.wasm_blob
                wasm_hash = plugin.wasm_hash

            wasm_url = request.build_absolute_uri(wasm_file.url) if wasm_file else None

            result.append(
                {
                    "slug": plugin.slug,
                    "name": plugin.name,
                    "version": version.version if version else plugin.version,
                    "author": plugin.app.name if plugin.app else "",
                    "hooks": plugin.hooks or [],
                    "permissions": plugin.required_permissions or [],
                    "min_engine_version": (
                        version.min_engine_version if version else plugin.min_engine_version
                    )
                    or "",
                    "wasm_url": wasm_url,
                    "wasm_hash": wasm_hash,
                    "config": sp.config or {},
                    "priority": sp.priority,
                }
            )

        return {"plugins": result}
