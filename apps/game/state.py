import msgpack
import redis.asyncio as aioredis
from django.conf import settings


class GameStateManager:
    """Manages game state in Redis using Hashes and Lists."""

    def __init__(self, match_id: str):
        self.match_id = match_id
        self.redis = None

    async def connect(self):
        self.redis = aioredis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_GAME_DB,
        )

    async def close(self):
        if self.redis:
            await self.redis.aclose()

    def _key(self, suffix: str) -> str:
        return f"game:{self.match_id}:{suffix}"

    # --- Meta ---

    async def init_meta(self, tick_interval_ms: int, max_players: int):
        await self.redis.hset(self._key("meta"), mapping={
            "status": "selecting",
            "current_tick": 0,
            "tick_interval_ms": tick_interval_ms,
            "max_players": max_players,
        })

    async def get_meta(self) -> dict:
        raw = await self.redis.hgetall(self._key("meta"))
        if not raw:
            return {}
        return {k.decode(): v.decode() for k, v in raw.items()}

    async def set_meta_field(self, field: str, value):
        await self.redis.hset(self._key("meta"), field, str(value))

    async def increment_tick(self) -> int:
        return await self.redis.hincrby(self._key("meta"), "current_tick", 1)

    # --- Players ---

    async def set_player(self, player_id: str, data: dict):
        await self.redis.hset(self._key("players"), player_id, msgpack.packb(data))

    async def get_player(self, player_id: str) -> dict | None:
        raw = await self.redis.hget(self._key("players"), player_id)
        return msgpack.unpackb(raw, raw=False) if raw else None

    async def get_all_players(self) -> dict:
        raw = await self.redis.hgetall(self._key("players"))
        return {k.decode(): msgpack.unpackb(v, raw=False) for k, v in raw.items()}

    # --- Regions ---

    async def set_region(self, region_id: str, data: dict):
        await self.redis.hset(self._key("regions"), region_id, msgpack.packb(data))

    async def get_region(self, region_id: str) -> dict | None:
        raw = await self.redis.hget(self._key("regions"), region_id)
        return msgpack.unpackb(raw, raw=False) if raw else None

    async def get_all_regions(self) -> dict:
        raw = await self.redis.hgetall(self._key("regions"))
        return {k.decode(): msgpack.unpackb(v, raw=False) for k, v in raw.items()}

    async def set_regions_bulk(self, regions: dict):
        """Set multiple regions at once using pipeline."""
        pipe = self.redis.pipeline()
        key = self._key("regions")
        for region_id, data in regions.items():
            pipe.hset(key, region_id, msgpack.packb(data))
        await pipe.execute()

    # --- Actions Queue ---

    async def push_action(self, action: dict):
        await self.redis.rpush(self._key("actions"), msgpack.packb(action))

    async def pop_all_actions(self) -> list:
        """Pop all pending actions atomically."""
        pipe = self.redis.pipeline()
        key = self._key("actions")
        pipe.lrange(key, 0, -1)
        pipe.delete(key)
        results = await pipe.execute()
        return [msgpack.unpackb(item, raw=False) for item in results[0]]

    # --- Building Queue ---

    async def push_building(self, building: dict):
        await self.redis.rpush(self._key("buildings_queue"), msgpack.packb(building))

    async def get_all_buildings(self) -> list:
        raw = await self.redis.lrange(self._key("buildings_queue"), 0, -1)
        return [msgpack.unpackb(item, raw=False) for item in raw]

    async def set_buildings(self, buildings: list):
        """Replace entire buildings queue."""
        key = self._key("buildings_queue")
        pipe = self.redis.pipeline()
        pipe.delete(key)
        for b in buildings:
            pipe.rpush(key, msgpack.packb(b))
        await pipe.execute()

    # --- Unit Queue ---

    async def get_all_unit_queue(self) -> list:
        raw = await self.redis.lrange(self._key("unit_queue"), 0, -1)
        return [msgpack.unpackb(item, raw=False) for item in raw]

    async def set_unit_queue(self, queue: list):
        key = self._key("unit_queue")
        pipe = self.redis.pipeline()
        pipe.delete(key)
        for item in queue:
            pipe.rpush(key, msgpack.packb(item))
        await pipe.execute()

    # --- Transit Queue ---

    async def get_all_transit_queue(self) -> list:
        raw = await self.redis.lrange(self._key("transit_queue"), 0, -1)
        return [msgpack.unpackb(item, raw=False) for item in raw]

    async def set_transit_queue(self, queue: list):
        key = self._key("transit_queue")
        pipe = self.redis.pipeline()
        pipe.delete(key)
        for item in queue:
            pipe.rpush(key, msgpack.packb(item))
        await pipe.execute()

    async def set_players_bulk(self, players: dict):
        """Set multiple players at once using pipeline."""
        pipe = self.redis.pipeline()
        key = self._key("players")
        for player_id, data in players.items():
            pipe.hset(key, player_id, msgpack.packb(data))
        await pipe.execute()

    # --- Tick helpers (pipelined reads + writes) ---

    async def get_tick_data(self) -> tuple:
        """Fetch all data needed for one tick in a single Redis pipeline.
        Returns (tick, players, regions, actions, buildings, unit_queue, transit_queue).
        """
        pipe = self.redis.pipeline()
        pipe.hincrby(self._key("meta"), "current_tick", 1)
        pipe.hgetall(self._key("players"))
        pipe.hgetall(self._key("regions"))
        actions_key = self._key("actions")
        pipe.lrange(actions_key, 0, -1)
        pipe.delete(actions_key)
        pipe.lrange(self._key("buildings_queue"), 0, -1)
        pipe.lrange(self._key("unit_queue"), 0, -1)
        pipe.lrange(self._key("transit_queue"), 0, -1)
        results = await pipe.execute()

        tick = results[0]
        players = {k.decode(): msgpack.unpackb(v, raw=False) for k, v in results[1].items()}
        regions = {k.decode(): msgpack.unpackb(v, raw=False) for k, v in results[2].items()}
        actions = [msgpack.unpackb(item, raw=False) for item in results[3]]
        buildings = [msgpack.unpackb(item, raw=False) for item in results[5]]
        unit_queue = [msgpack.unpackb(item, raw=False) for item in results[6]]
        transit_queue = [msgpack.unpackb(item, raw=False) for item in results[7]]
        return tick, players, regions, actions, buildings, unit_queue, transit_queue

    async def set_tick_result(self, result: dict):
        """Write all tick results in a single Redis pipeline."""
        pipe = self.redis.pipeline()

        regions_key = self._key("regions")
        for region_id, data in result["regions"].items():
            pipe.hset(regions_key, region_id, msgpack.packb(data))

        players_key = self._key("players")
        for pid, pdata in result["players"].items():
            pipe.hset(players_key, pid, msgpack.packb(pdata))

        buildings_key = self._key("buildings_queue")
        pipe.delete(buildings_key)
        for b in result["buildings_queue"]:
            pipe.rpush(buildings_key, msgpack.packb(b))

        unit_key = self._key("unit_queue")
        pipe.delete(unit_key)
        for item in result["unit_queue"]:
            pipe.rpush(unit_key, msgpack.packb(item))

        transit_key = self._key("transit_queue")
        pipe.delete(transit_key)
        for item in result["transit_queue"]:
            pipe.rpush(transit_key, msgpack.packb(item))

        await pipe.execute()

    # --- Full State ---

    async def get_full_state(self) -> dict:
        """Fetch full game state in a single Redis pipeline."""
        pipe = self.redis.pipeline()
        pipe.hgetall(self._key("meta"))
        pipe.hgetall(self._key("players"))
        pipe.hgetall(self._key("regions"))
        pipe.lrange(self._key("buildings_queue"), 0, -1)
        pipe.lrange(self._key("unit_queue"), 0, -1)
        pipe.lrange(self._key("transit_queue"), 0, -1)
        meta_raw, players_raw, regions_raw, buildings_raw, unit_raw, transit_raw = await pipe.execute()

        return {
            "meta": {k.decode(): v.decode() for k, v in meta_raw.items()},
            "players": {k.decode(): msgpack.unpackb(v, raw=False) for k, v in players_raw.items()},
            "regions": {k.decode(): msgpack.unpackb(v, raw=False) for k, v in regions_raw.items()},
            "buildings_queue": [msgpack.unpackb(i, raw=False) for i in buildings_raw],
            "unit_queue": [msgpack.unpackb(i, raw=False) for i in unit_raw],
            "transit_queue": [msgpack.unpackb(i, raw=False) for i in transit_raw],
        }

    # --- Cleanup ---

    async def cleanup(self):
        """Remove all keys for this match."""
        keys = [
            self._key("meta"),
            self._key("players"),
            self._key("regions"),
            self._key("actions"),
            self._key("buildings_queue"),
            self._key("unit_queue"),
            self._key("transit_queue"),
        ]
        await self.redis.delete(*keys)
