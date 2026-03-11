import asyncio
import copy
import logging
import random
import time

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
        self.capital_selection_task: asyncio.Task | None = None
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

        await self._ensure_game_initialized()

        meta = await self.state_manager.get_meta()
        if meta.get("status") == "selecting":
            await self._finalize_capital_selection_if_expired()
            await self._try_schedule_capital_selection_timeout()
        elif meta.get("status") == "in_progress":
            # Game is running but the loop owner may have disconnected.
            # Try to acquire the lock and resume — if the lock is already held
            # (another consumer is running the loop) this is a no-op.
            await self._try_resume_game_loop()

        state = await self.state_manager.get_full_state()
        await self.send_json({"type": "game_state", "state": state})

    async def disconnect(self, close_code):
        if self.capital_selection_task and not self.capital_selection_task.done():
            self.capital_selection_task.cancel()
            try:
                await asyncio.wait_for(self.capital_selection_task, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
            if self.state_manager:
                try:
                    await self.state_manager.redis.delete(
                        f"game:{self.match_id}:capital_timer_lock"
                    )
                except Exception:
                    pass

        # Cancel the game loop task BEFORE closing state_manager/Redis,
        # otherwise the running loop crashes mid-tick with a connection error.
        if self.game_loop_task and not self.game_loop_task.done():
            self.game_loop_task.cancel()
            try:
                await asyncio.wait_for(self.game_loop_task, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
            # Release the lock so the next consumer that connects can resume the loop.
            if self.state_manager:
                try:
                    lock_key = f"game:{self.match_id}:loop_lock"
                    await self.state_manager.redis.delete(lock_key)
                except Exception:
                    pass

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
        elif action in ("attack", "move", "build", "produce_unit"):
            await self.state_manager.push_action({
                "action_type": action,
                "player_id": str(self.user.id),
                **{k: v for k, v in content.items() if k != "action"},
            })

    # ------------------------------------------------------------------
    # Capital selection
    # ------------------------------------------------------------------

    async def _ensure_game_initialized(self):
        """Initialize Redis state once, and wait until it is fully available."""
        if await self._is_game_initialized():
            return

        lock_key = f"game:{self.match_id}:init_lock"
        acquired = await self.state_manager.redis.set(lock_key, "1", nx=True, ex=15)

        if acquired:
            try:
                if not await self._is_game_initialized():
                    await self._initialize_game()
            finally:
                await self.state_manager.redis.delete(lock_key)
            return

        for _ in range(30):
            if await self._is_game_initialized():
                return
            await asyncio.sleep(0.1)

        # Last-resort self-heal if another initializer died mid-flight.
        reacquired = await self.state_manager.redis.set(lock_key, "1", nx=True, ex=15)
        if reacquired:
            try:
                if not await self._is_game_initialized():
                    await self._initialize_game()
            finally:
                await self.state_manager.redis.delete(lock_key)

    async def _is_game_initialized(self) -> bool:
        meta = await self.state_manager.get_meta()
        if not meta:
            return False

        players = await self.state_manager.get_all_players()
        regions = await self.state_manager.get_all_regions()
        if not players or not regions:
            return False

        return str(self.user.id) in players

    async def _handle_select_capital(self, content):
        region_id = content.get("region_id")
        player_id = str(self.user.id)
        logger.info("select_capital: player=%s region=%s", player_id, region_id)

        await self._finalize_capital_selection_if_expired()

        # Fast pre-check (before acquiring lock)
        player = await self.state_manager.get_player(player_id)
        if not player:
            logger.warning("select_capital: player %s not found in game state", player_id)
            return
        if player.get("capital_region_id"):
            await self.send_json({"type": "error", "message": "Już wybrałeś stolicę"})
            return

        # Acquire per-region lock — prevents two players claiming the same region
        # simultaneously (race condition: both read owner_id=None before either writes)
        lock_key = f"game:{self.match_id}:capital_lock:{region_id}"
        acquired = await self.state_manager.redis.set(lock_key, player_id, nx=True, ex=5)
        if not acquired:
            await self.send_json({"type": "error", "message": "Ten region jest już zajęty"})
            return

        try:
            # Re-validate everything inside the lock
            player = await self.state_manager.get_player(player_id)
            if not player or player.get("capital_region_id"):
                await self.send_json({"type": "error", "message": "Już wybrałeś stolicę"})
                return

            region = await self.state_manager.get_region(region_id)
            if not region:
                await self.send_json({"type": "error", "message": "Region nie istnieje"})
                return

            if region.get("owner_id"):
                await self.send_json({"type": "error", "message": "Ten region jest już zajęty"})
                return

            meta = await self.state_manager.get_meta()
            starting_units = int(meta.get("starting_units", 10))
            min_dist = int(meta.get("min_capital_distance", 3))

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
            region["unit_type"] = region.get("unit_type") or "infantry"
            region["units"] = {region["unit_type"]: starting_units}
            await self.state_manager.set_region(region_id, region)

        finally:
            await self.state_manager.redis.delete(lock_key)

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

    async def _try_schedule_capital_selection_timeout(self):
        lock_key = f"game:{self.match_id}:capital_timer_lock"
        acquired = await self.state_manager.redis.set(lock_key, "1", nx=True, ex=3600)
        if not acquired:
            return

        meta = await self.state_manager.get_meta()
        ends_at = int(meta.get("capital_selection_ends_at", "0") or 0)
        delay = max(0, ends_at - int(time.time()))
        self.capital_selection_task = asyncio.create_task(
            self._capital_selection_timeout_task(delay)
        )

    async def _capital_selection_timeout_task(self, delay: int):
        lock_key = f"game:{self.match_id}:capital_timer_lock"
        try:
            if delay > 0:
                await asyncio.sleep(delay)
            await self._finalize_capital_selection_if_expired()
        except asyncio.CancelledError:
            raise
        finally:
            if self.state_manager:
                await self.state_manager.redis.delete(lock_key)

    async def _finalize_capital_selection_if_expired(self):
        meta = await self.state_manager.get_meta()
        if meta.get("status") != "selecting":
            return

        ends_at = int(meta.get("capital_selection_ends_at", "0") or 0)
        if ends_at > int(time.time()):
            return

        lock_key = f"game:{self.match_id}:capital_finalize_lock"
        acquired = await self.state_manager.redis.set(lock_key, "1", nx=True, ex=30)
        if not acquired:
            return

        try:
            meta = await self.state_manager.get_meta()
            if meta.get("status") != "selecting":
                return
            ends_at = int(meta.get("capital_selection_ends_at", "0") or 0)
            if ends_at > int(time.time()):
                return
            await self._auto_assign_missing_capitals()
        finally:
            await self.state_manager.redis.delete(lock_key)

    async def _auto_assign_missing_capitals(self):
        meta = await self.state_manager.get_meta()
        if meta.get("status") != "selecting":
            return

        players = await self.state_manager.get_all_players()
        regions = await self.state_manager.get_all_regions()
        if not players or not regions:
            return

        min_dist = int(meta.get("min_capital_distance", 3))
        starting_units = int(meta.get("starting_units", 10))
        neighbor_map = await self._load_neighbor_map()
        missing_player_ids = [
            player_id
            for player_id, player in players.items()
            if not player.get("capital_region_id")
        ]

        if not missing_player_ids:
            await self._check_all_capitals_selected()
            return

        random.shuffle(missing_player_ids)

        for player_id in missing_player_ids:
            region_id = self._pick_random_capital_region(
                regions,
                neighbor_map,
                min_dist,
            )
            if not region_id:
                continue

            player = players[player_id]
            player["capital_region_id"] = region_id
            await self.state_manager.set_player(player_id, player)

            region = regions[region_id]
            region["owner_id"] = player_id
            region["is_capital"] = True
            region["unit_count"] = starting_units
            region["unit_type"] = region.get("unit_type") or "infantry"
            region["units"] = {region["unit_type"]: starting_units}
            regions[region_id] = region
            await self.state_manager.set_region(region_id, region)

        state = await self.state_manager.get_full_state()
        await self.channel_layer.group_send(self.game_group, {
            "type": "broadcast_state",
            "state": state,
        })
        await self._check_all_capitals_selected()

    def _pick_random_capital_region(
        self,
        regions: dict,
        neighbor_map: dict,
        min_distance: int,
    ) -> str | None:
        available_region_ids = [
            region_id
            for region_id, region in regions.items()
            if not region.get("owner_id")
        ]
        random.shuffle(available_region_ids)

        existing_capitals = {
            region_id
            for region_id, region in regions.items()
            if region.get("is_capital")
        }

        for region_id in available_region_ids:
            if self._is_region_valid_for_capital(
                region_id,
                existing_capitals,
                neighbor_map,
                regions,
                min_distance,
            ):
                return region_id

        return available_region_ids[0] if available_region_ids else None

    def _is_region_valid_for_capital(
        self,
        region_id: str,
        existing_capitals: set[str],
        neighbor_map: dict,
        regions: dict,
        min_distance: int,
    ) -> bool:
        if not existing_capitals:
            return True

        from collections import deque

        visited = {region_id}
        queue = deque([(region_id, 0)])
        while queue:
            current, dist = queue.popleft()
            if dist > 0 and current in existing_capitals:
                return False
            if dist >= min_distance:
                continue
            for neighbor in neighbor_map.get(current, []):
                if neighbor in regions and neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, dist + 1))
        return True

    @database_sync_to_async
    def _update_match_status_db(self, status: str):
        from apps.matchmaking.models import Match
        Match.objects.filter(id=self.match_id).update(status=status)

    # ------------------------------------------------------------------
    # Game loop
    # ------------------------------------------------------------------

    async def _try_resume_game_loop(self):
        """Called on connect when game is already in_progress.

        Tries to claim the loop lock.  If successful this consumer becomes the
        new loop owner and starts running ticks.  If the lock is already held
        by another consumer the call is a no-op.
        """
        lock_key = f"game:{self.match_id}:loop_lock"
        acquired = await self.state_manager.redis.set(lock_key, "1", nx=True, ex=3600)
        if not acquired:
            return  # another consumer is already running the loop

        logger.info("match %s: resuming orphaned game loop", self.match_id)
        neighbor_map = await self._load_neighbor_map()
        settings_snapshot = await self._get_settings_snapshot()
        engine = GameEngine(settings_snapshot, neighbor_map)
        meta = await self.state_manager.get_meta()
        tick_interval = int(meta.get("tick_interval_ms", 1000)) / 1000.0
        self.game_loop_task = asyncio.create_task(
            self._game_loop_supervised(engine, tick_interval)
        )

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
            self._game_loop_supervised(engine, tick_interval)
        )

    async def _game_loop_supervised(self, engine: GameEngine, tick_interval: float):
        """Wrapper that restarts the game loop on crash (up to MAX_RETRIES times)."""
        MAX_RETRIES = 3
        lock_key = f"game:{self.match_id}:loop_lock"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                await self._game_loop(engine, tick_interval)
                return  # clean exit (game over or cancelled)
            except asyncio.CancelledError:
                logger.info("Game loop cancelled for match %s", self.match_id)
                raise
            except Exception:
                logger.exception(
                    "Game loop crashed (attempt %d/%d) for match %s",
                    attempt, MAX_RETRIES, self.match_id,
                )
                if attempt < MAX_RETRIES:
                    try:
                        await self.channel_layer.group_send(self.game_group, {
                            "type": "game_error",
                            "message": "Chwilowy błąd serwera, wznawianie gry...",
                        })
                    except Exception:
                        pass
                    await asyncio.sleep(1.0)
                    # Re-extend lock for next attempt
                    await self.state_manager.redis.set(lock_key, "1", ex=3600)
                else:
                    logger.error("Game loop permanently failed for match %s", self.match_id)
                    try:
                        await self.channel_layer.group_send(self.game_group, {
                            "type": "game_error",
                            "message": "Krytyczny błąd serwera gry",
                        })
                    except Exception:
                        pass
        await self.state_manager.redis.delete(lock_key)

    async def _game_loop(self, engine: GameEngine, tick_interval: float):
        """Main game loop — runs until game over or cancelled. Raises on error."""
        snapshot_interval = 30  # save snapshot every N ticks
        next_tick_at = asyncio.get_running_loop().time() + tick_interval

        while True:
            await asyncio.sleep(max(0.0, next_tick_at - asyncio.get_running_loop().time()))
            tick_start = asyncio.get_running_loop().time()

            # Single pipeline read — replaces 7 individual Redis calls
            tick, players, regions, actions, buildings, unit_queue, transit_queue = (
                await self.state_manager.get_tick_data()
            )
            regions_before_tick = copy.deepcopy(regions)

            result = engine.process_tick(players, regions, actions, buildings, unit_queue, transit_queue)

            # Delta broadcast — only send regions that changed this tick,
            # and strip sea_distances (static, sent once on game_state init).
            changed_regions = self._compute_changed_regions(
                previous_regions=regions_before_tick,
                current_regions=result["regions"],
            )

            # Write only dirty regions to Redis — avoids N HSET per tick on large maps.
            dirty_ids = set(changed_regions.keys())
            await self.state_manager.set_tick_result(result, dirty_region_ids=dirty_ids)

            await self.channel_layer.group_send(self.game_group, {
                "type": "game_tick",
                "tick": tick,
                "events": result["events"],
                "regions": changed_regions,
                "players": result["players"],
                "buildings_queue": result["buildings_queue"],
                "unit_queue": result["unit_queue"],
                "transit_queue": result["transit_queue"],
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
                return

            # Compensate for processing time — sleep only the remaining portion
            # of the tick interval so ticks don't drift on slow hardware (Pi).
            elapsed = asyncio.get_running_loop().time() - tick_start
            next_tick_at += tick_interval
            if elapsed > tick_interval:
                next_tick_at = asyncio.get_running_loop().time()

    @staticmethod
    def _compute_changed_regions(previous_regions: dict, current_regions: dict) -> dict:
        return {
            rid: {k: v for k, v in data.items() if k != "sea_distances"}
            for rid, data in current_regions.items()
            if data != previous_regions.get(rid)
        }

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
                "centroid": [float(r.centroid.x), float(r.centroid.y)] if r.centroid else None,
                "owner_id": None,
                "unit_count": 0,
                "unit_type": None,
                "is_capital": False,
                "building_type": None,
                "buildings": {},
                "defense_bonus": 0,
                "vision_range": 0,
                "unit_generation_bonus": 0,
                "currency_generation_bonus": 0,
                "is_coastal": r.is_coastal,
                "sea_distances": r.sea_distances or [],
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
        await self.state_manager.set_meta_field(
            "starting_currency", settings_snapshot.get("starting_currency", 120)
        )
        capital_selection_time_seconds = int(
            settings_snapshot.get("capital_selection_time_seconds", 30)
        )
        await self.state_manager.set_meta_field(
            "capital_selection_time_seconds", capital_selection_time_seconds
        )
        await self.state_manager.set_meta_field(
            "capital_selection_ends_at", int(time.time()) + capital_selection_time_seconds
        )

        for p in match_data["players"]:
            await self.state_manager.set_player(p["user_id"], {
                "user_id": p["user_id"],
                "username": p["username"],
                "color": p["color"],
                "is_alive": True,
                "capital_region_id": None,
                "currency": int(settings_snapshot.get("starting_currency", 120)),
            })

        neutral_min = int(settings_snapshot.get("neutral_region_min_units", 1))
        neutral_max = int(settings_snapshot.get("neutral_region_max_units", 11))
        default_unit_type_slug = settings_snapshot.get("default_unit_type_slug", "infantry")
        regions = await self._load_regions_for_match()
        for region in regions.values():
            region["unit_count"] = random.randint(neutral_min, neutral_max)
            region["unit_type"] = default_unit_type_slug
            region["units"] = {default_unit_type_slug: region["unit_count"]}
        await self.state_manager.set_regions_bulk(regions)
