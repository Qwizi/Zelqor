import asyncio
import logging
import random

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.game.engine import GameEngine
from apps.game.state import GameStateManager

logger = logging.getLogger(__name__)


class GameConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket consumer for a game match.

    Handles:
      - capital selection phase
      - queuing player actions
      - running the asyncio game loop (one loop per match, guarded by Redis lock)
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.match_id: str | None = None
        self.state_manager: GameStateManager | None = None
        self.game_loop_task: asyncio.Task | None = None
        self.game_group: str | None = None

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self):
        self.user = self.scope.get("user")
        if not self.user or self.user.is_anonymous:
            await self.close(code=4001)
            return

        self.match_id = self.scope["url_route"]["kwargs"]["match_id"]
        self.game_group = f"game_{self.match_id}"

        if not await self._verify_player():
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.game_group, self.channel_name)
        await self.accept()

        self.state_manager = GameStateManager(self.match_id)
        await self.state_manager.connect()

        # First player to connect initializes game state in Redis
        meta = await self.state_manager.get_meta()
        if not meta:
            await self._initialize_game()

        state = await self.state_manager.get_full_state()
        await self.send_json({"type": "game_state", "state": state})

    async def disconnect(self, close_code):
        if self.game_group:
            await self.channel_layer.group_discard(self.game_group, self.channel_name)
        if self.state_manager:
            await self.state_manager.close()

    # ------------------------------------------------------------------
    # Incoming messages
    # ------------------------------------------------------------------

    async def receive_json(self, content):
        action = content.get("action")

        if action == "select_capital":
            await self._handle_select_capital(content)
        elif action in ("attack", "move", "build"):
            await self.state_manager.push_action({
                "action_type": action,
                "player_id": str(self.user.id),
                **{k: v for k, v in content.items() if k != "action"},
            })

    # ------------------------------------------------------------------
    # Capital selection
    # ------------------------------------------------------------------

    async def _handle_select_capital(self, content):
        region_id = content.get("region_id")
        player_id = str(self.user.id)
        logger.info("select_capital: player=%s region=%s", player_id, region_id)

        player = await self.state_manager.get_player(player_id)
        if not player:
            logger.warning("select_capital: player %s not found in game state", player_id)
            return

        # Already selected a capital
        if player.get("capital_region_id"):
            await self.send_json({
                "type": "error",
                "message": "Już wybrałeś stolicę",
            })
            return

        region = await self.state_manager.get_region(region_id)
        if not region:
            logger.warning("select_capital: region %s not found", region_id)
            await self.send_json({
                "type": "error",
                "message": "Region nie istnieje",
            })
            return

        # Region already owned by another player
        if region.get("owner_id"):
            logger.warning("select_capital: region %s already owned by %s", region_id, region.get("owner_id"))
            await self.send_json({
                "type": "error",
                "message": "Ten region jest już zajęty",
            })
            return

        meta = await self.state_manager.get_meta()
        starting_units = int(meta.get("starting_units", 10))

        # Distance check — capitals must be at least N hops apart
        settings_snapshot = await self._get_settings_snapshot()
        min_dist = int(settings_snapshot.get("min_capital_distance", 3))
        if await self._is_capital_too_close(region_id, min_dist):
            await self.send_json({
                "type": "error",
                "message": f"Stolica musi być co najmniej {min_dist} regiony od stolicy innego gracza",
            })
            return

        player["capital_region_id"] = region_id
        await self.state_manager.set_player(player_id, player)

        region["owner_id"] = player_id
        region["is_capital"] = True
        region["unit_count"] = starting_units
        await self.state_manager.set_region(region_id, region)

        # Broadcast full updated state so all clients see the change
        state = await self.state_manager.get_full_state()
        await self.channel_layer.group_send(self.game_group, {
            "type": "broadcast_state",
            "state": state,
        })

        await self._check_all_capitals_selected()

    async def _is_capital_too_close(self, region_id: str, min_distance: int) -> bool:
        """BFS from region_id; returns True if any existing capital is within min_distance hops."""
        from collections import deque
        regions = await self.state_manager.get_all_regions()
        existing_capitals = {rid for rid, r in regions.items() if r.get("is_capital")}
        if not existing_capitals:
            return False
        neighbor_map = await self._load_neighbor_map()
        visited = {region_id}
        queue = deque([(region_id, 0)])
        while queue:
            current, dist = queue.popleft()
            if dist > 0 and current in existing_capitals:
                return True
            if dist >= min_distance:
                continue
            for neighbor in neighbor_map.get(current, []):
                # Only traverse match regions — hop count must reflect in-game graph
                if neighbor not in visited and neighbor in regions:
                    visited.add(neighbor)
                    queue.append((neighbor, dist + 1))
        return False

    async def _check_all_capitals_selected(self):
        players = await self.state_manager.get_all_players()
        meta = await self.state_manager.get_meta()
        expected = int(meta.get("max_players", 0))
        if (
            players
            and len(players) >= expected
            and all(p.get("capital_region_id") is not None for p in players.values())
        ):
            await self.state_manager.set_meta_field("status", "in_progress")
            await self._update_match_status_db("in_progress")
            await self.channel_layer.group_send(self.game_group, {
                "type": "game_starting",
            })
            await self._start_game_loop()

    @database_sync_to_async
    def _update_match_status_db(self, status: str):
        from apps.matchmaking.models import Match
        Match.objects.filter(id=self.match_id).update(status=status)

    # ------------------------------------------------------------------
    # Game loop
    # ------------------------------------------------------------------

    async def _start_game_loop(self):
        meta = await self.state_manager.get_meta()
        if meta.get("status") != "in_progress":
            return

        # Only one consumer runs the loop — Redis SETNX lock
        lock_key = f"game:{self.match_id}:loop_lock"
        acquired = await self.state_manager.redis.set(lock_key, "1", nx=True, ex=3600)
        if not acquired:
            return

        neighbor_map = await self._load_neighbor_map()
        settings_snapshot = await self._get_settings_snapshot()
        engine = GameEngine(settings_snapshot, neighbor_map)

        tick_interval = int(meta.get("tick_interval_ms", 1000)) / 1000.0

        self.game_loop_task = asyncio.create_task(
            self._game_loop(engine, tick_interval)
        )

    async def _game_loop(self, engine: GameEngine, tick_interval: float):
        """Main game loop — runs until game over or cancelled."""
        snapshot_interval = 30  # save snapshot every N ticks

        try:
            while True:
                await asyncio.sleep(tick_interval)

                tick = await self.state_manager.increment_tick()
                players = await self.state_manager.get_all_players()
                regions = await self.state_manager.get_all_regions()
                actions = await self.state_manager.pop_all_actions()
                buildings = await self.state_manager.get_all_buildings()

                result = engine.process_tick(players, regions, actions, buildings)

                # Persist updated state
                await self.state_manager.set_regions_bulk(result["regions"])
                for pid, pdata in result["players"].items():
                    await self.state_manager.set_player(pid, pdata)
                await self.state_manager.set_buildings(result["buildings_queue"])

                # Broadcast tick
                await self.channel_layer.group_send(self.game_group, {
                    "type": "game_tick",
                    "tick": tick,
                    "events": result["events"],
                    "regions": result["regions"],
                    "players": result["players"],
                    "buildings_queue": result["buildings_queue"],
                })

                # Periodic snapshot → Celery → PostgreSQL
                if tick % snapshot_interval == 0:
                    from apps.game.tasks import save_game_snapshot

                    state = await self.state_manager.get_full_state()
                    save_game_snapshot.delay(str(self.match_id), tick, state)

                # Game over?
                if any(e["type"] == "game_over" for e in result["events"]):
                    await self.state_manager.set_meta_field("status", "finished")
                    winner_event = next(
                        (e for e in result["events"] if e["type"] == "game_over"), None
                    )
                    if winner_event:
                        await self._dispatch_finalization(
                            winner_event.get("winner_id"), tick
                        )
                    break

        except asyncio.CancelledError:
            logger.info("Game loop cancelled for match %s", self.match_id)
        except Exception:
            logger.exception("Game loop error for match %s", self.match_id)
            await self.channel_layer.group_send(self.game_group, {
                "type": "game_error",
                "message": "Internal game error",
            })
        finally:
            lock_key = f"game:{self.match_id}:loop_lock"
            await self.state_manager.redis.delete(lock_key)

    async def _dispatch_finalization(self, winner_id: str | None, total_ticks: int):
        """Get final state from Redis and dispatch Celery tasks for DB persistence."""
        from apps.game.tasks import cleanup_redis_game_state, finalize_match_results

        final_state = await self.state_manager.get_full_state()

        finalize_match_results.delay(
            str(self.match_id), winner_id, total_ticks, final_state
        )
        # Clean up Redis after a delay (players may still be connected)
        cleanup_redis_game_state.apply_async(
            args=[str(self.match_id)], countdown=120
        )

    # ------------------------------------------------------------------
    # Channel layer handlers (group_send → individual WS)
    # ------------------------------------------------------------------

    async def game_tick(self, event):
        await self.send_json(event)

    async def broadcast_state(self, event):
        await self.send_json({"type": "game_state", "state": event["state"]})

    async def capital_selected(self, event):
        await self.send_json({"type": "capital_selected", **event})

    async def game_starting(self, event):
        await self.send_json({"type": "game_starting"})

    async def game_error(self, event):
        await self.send_json({"type": "error", "message": event.get("message", "")})

    # ------------------------------------------------------------------
    # DB helpers (sync → async wrappers)
    # ------------------------------------------------------------------

    @database_sync_to_async
    def _verify_player(self):
        from apps.matchmaking.models import MatchPlayer
        return MatchPlayer.objects.filter(match_id=self.match_id, user=self.user).exists()

    @database_sync_to_async
    def _get_settings_snapshot(self) -> dict:
        from apps.matchmaking.models import Match
        return Match.objects.get(id=self.match_id).settings_snapshot

    @database_sync_to_async
    def _load_neighbor_map(self) -> dict:
        from apps.geo.models import Region
        neighbor_map = {}
        for region in Region.objects.prefetch_related("neighbors").all():
            neighbor_map[str(region.id)] = [str(n.id) for n in region.neighbors.all()]
        return neighbor_map

    @database_sync_to_async
    def _get_match_data(self) -> dict:
        from apps.matchmaking.models import Match
        match = Match.objects.prefetch_related("players__user").get(id=self.match_id)
        return {
            "max_players": match.max_players,
            "players": [
                {
                    "user_id": str(p.user.id),
                    "username": p.user.username,
                    "color": p.color,
                }
                for p in match.players.all()
            ],
        }

    @database_sync_to_async
    def _load_regions_for_match(self) -> dict:
        from apps.geo.models import Region
        from apps.matchmaking.models import Match

        match = Match.objects.select_related("map_config").get(id=self.match_id)
        qs = Region.objects.select_related("country")

        if match.map_config and match.map_config.country_codes:
            qs = qs.filter(country__code__in=match.map_config.country_codes)

        return {
            str(r.id): {
                "name": r.name,
                "country_code": r.country.code,
                "owner_id": None,
                "unit_count": 0,
                "is_capital": False,
                "building_type": None,
                "defense_bonus": 0,
                "vision_range": 0,
                "unit_generation_bonus": 0,
                "is_coastal": r.is_coastal,
            }
            for r in qs
        }

    async def _initialize_game(self):
        """Populate Redis with initial game state from DB."""
        match_data = await self._get_match_data()
        settings_snapshot = await self._get_settings_snapshot()

        await self.state_manager.init_meta(
            tick_interval_ms=settings_snapshot.get("tick_interval_ms", 1000),
            max_players=match_data["max_players"],
        )
        await self.state_manager.set_meta_field(
            "starting_units", settings_snapshot.get("starting_units", 10)
        )
        await self.state_manager.set_meta_field(
            "min_capital_distance", settings_snapshot.get("min_capital_distance", 3)
        )
        await self.state_manager.set_meta_field(
            "neutral_region_units", settings_snapshot.get("neutral_region_units", 3)
        )

        for p in match_data["players"]:
            await self.state_manager.set_player(p["user_id"], {
                "user_id": p["user_id"],
                "username": p["username"],
                "color": p["color"],
                "is_alive": True,
                "capital_region_id": None,
            })

        neutral_min = int(settings_snapshot.get("neutral_region_min_units", 1))
        neutral_max = int(settings_snapshot.get("neutral_region_max_units", 11))
        regions = await self._load_regions_for_match()
        for region in regions.values():
            region["unit_count"] = random.randint(neutral_min, neutral_max)
        await self.state_manager.set_regions_bulk(regions)
