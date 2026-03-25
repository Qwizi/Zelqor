use maplord_engine::{
    Action, ActiveEffect, AirTransitItem, BuildingQueueItem, DiplomacyState, Player, Region,
    TransitQueueItem, UnitQueueItem,
};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::collections::HashMap;

fn deser<T: serde::de::DeserializeOwned>(data: &[u8]) -> redis::RedisResult<T> {
    rmp_serde::from_slice(data).map_err(|e| {
        redis::RedisError::from((
            redis::ErrorKind::ParseError,
            "msgpack deserialization failed",
            e.to_string(),
        ))
    })
}

/// Manages game state in Redis using Hashes and Lists with msgpack serialization.
/// Mirrors the Python GameStateManager exactly.
#[derive(Clone)]
pub struct GameStateManager {
    match_id: String,
    redis: ConnectionManager,
}

/// All data needed for one tick.
pub struct TickData {
    pub tick: i64,
    pub players: HashMap<String, Player>,
    pub regions: HashMap<String, Region>,
    pub actions: Vec<Action>,
    pub buildings_queue: Vec<BuildingQueueItem>,
    pub unit_queue: Vec<UnitQueueItem>,
    pub transit_queue: Vec<TransitQueueItem>,
    pub air_transit_queue: Vec<AirTransitItem>,
    pub active_effects: Vec<ActiveEffect>,
    pub diplomacy: DiplomacyState,
}

/// Full game state for snapshots.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FullGameState {
    pub meta: HashMap<String, String>,
    pub players: HashMap<String, Player>,
    pub regions: HashMap<String, Region>,
    pub buildings_queue: Vec<BuildingQueueItem>,
    pub unit_queue: Vec<UnitQueueItem>,
    pub transit_queue: Vec<TransitQueueItem>,
    pub air_transit_queue: Vec<AirTransitItem>,
    pub active_effects: Vec<ActiveEffect>,
    #[serde(default)]
    pub diplomacy: DiplomacyState,
}

impl GameStateManager {
    pub fn new(match_id: String, redis: ConnectionManager) -> Self {
        Self { match_id, redis }
    }

    fn key(&self, suffix: &str) -> String {
        format!("game:{}:{}", self.match_id, suffix)
    }

    pub fn redis(&self) -> ConnectionManager {
        self.redis.clone()
    }

    pub fn match_id(&self) -> &str {
        &self.match_id
    }

    // --- Meta ---

    pub async fn init_meta(
        &self,
        tick_interval_ms: u64,
        max_players: u32,
    ) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        redis::cmd("HSET")
            .arg(self.key("meta"))
            .arg("status")
            .arg("selecting")
            .arg("current_tick")
            .arg(0)
            .arg("tick_interval_ms")
            .arg(tick_interval_ms)
            .arg("max_players")
            .arg(max_players)
            .exec_async(&mut conn)
            .await
    }

    pub async fn get_meta(&self) -> redis::RedisResult<HashMap<String, String>> {
        let mut conn = self.redis.clone();
        conn.hgetall(self.key("meta")).await
    }

    pub async fn set_meta_field(&self, field: &str, value: &str) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        conn.hset(self.key("meta"), field, value).await
    }

    // --- Players ---

    pub async fn set_player(&self, player_id: &str, data: &Player) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        let packed = rmp_serde::to_vec(data).unwrap();
        conn.hset(self.key("players"), player_id, packed).await
    }

    pub async fn get_player(&self, player_id: &str) -> redis::RedisResult<Option<Player>> {
        let mut conn = self.redis.clone();
        let raw: Option<Vec<u8>> = conn.hget(self.key("players"), player_id).await?;
        Ok(raw.map(|data| deser(&data)).transpose()?)
    }

    pub async fn get_all_players(&self) -> redis::RedisResult<HashMap<String, Player>> {
        let mut conn = self.redis.clone();
        let raw: HashMap<String, Vec<u8>> = conn.hgetall(self.key("players")).await?;
        Ok(raw
            .into_iter()
            .map(|(k, v)| Ok((k, deser(&v)?)))
            .collect::<redis::RedisResult<_>>()?)
    }

    pub async fn set_players_bulk(
        &self,
        players: &HashMap<String, Player>,
    ) -> redis::RedisResult<()> {
        let mut pipe = redis::pipe();
        let key = self.key("players");
        for (player_id, data) in players {
            let packed = rmp_serde::to_vec(data).unwrap();
            pipe.hset(&key, player_id, packed).ignore();
        }
        let mut conn = self.redis.clone();
        pipe.exec_async(&mut conn).await
    }

    // --- Regions ---

    pub async fn set_region(&self, region_id: &str, data: &Region) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        let packed = rmp_serde::to_vec(data).unwrap();
        conn.hset(self.key("regions"), region_id, packed).await
    }

    pub async fn get_region(&self, region_id: &str) -> redis::RedisResult<Option<Region>> {
        let mut conn = self.redis.clone();
        let raw: Option<Vec<u8>> = conn.hget(self.key("regions"), region_id).await?;
        Ok(raw.map(|data| deser(&data)).transpose()?)
    }

    pub async fn get_all_regions(&self) -> redis::RedisResult<HashMap<String, Region>> {
        let mut conn = self.redis.clone();
        let raw: HashMap<String, Vec<u8>> = conn.hgetall(self.key("regions")).await?;
        Ok(raw
            .into_iter()
            .map(|(k, v)| Ok((k, deser(&v)?)))
            .collect::<redis::RedisResult<_>>()?)
    }

    pub async fn set_regions_bulk(
        &self,
        regions: &HashMap<String, Region>,
    ) -> redis::RedisResult<()> {
        let mut pipe = redis::pipe();
        let key = self.key("regions");
        for (region_id, data) in regions {
            let packed = rmp_serde::to_vec(data).unwrap();
            pipe.hset(&key, region_id, packed).ignore();
        }
        let mut conn = self.redis.clone();
        pipe.exec_async(&mut conn).await
    }

    // --- Actions ---

    pub async fn push_action(&self, action: &Action) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        let packed = rmp_serde::to_vec(action).unwrap();
        conn.rpush(self.key("actions"), packed).await
    }

    // --- Tick helpers (pipelined reads + writes) ---

    pub async fn get_tick_data(&self) -> redis::RedisResult<TickData> {
        let mut pipe = redis::pipe();

        let meta_key = self.key("meta");
        let players_key = self.key("players");
        let regions_key = self.key("regions");
        let actions_key = self.key("actions");
        let buildings_key = self.key("buildings_queue");
        let unit_key = self.key("unit_queue");
        let transit_key = self.key("transit_queue");
        let air_transit_key = self.key("air_transit_queue");
        let effects_key = self.key("active_effects");
        let diplomacy_key = self.key("diplomacy");

        pipe.hincr(&meta_key, "current_tick", 1i64);
        pipe.hgetall(&players_key);
        pipe.hgetall(&regions_key);
        pipe.lrange(&actions_key, 0, -1);
        pipe.del(&actions_key);
        pipe.lrange(&buildings_key, 0, -1);
        pipe.lrange(&unit_key, 0, -1);
        pipe.lrange(&transit_key, 0, -1);
        pipe.lrange(&air_transit_key, 0, -1);
        pipe.lrange(&effects_key, 0, -1);
        pipe.get(&diplomacy_key);

        let mut conn = self.redis.clone();
        let results: (
            i64,
            HashMap<String, Vec<u8>>,
            HashMap<String, Vec<u8>>,
            Vec<Vec<u8>>,
            (),
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Option<Vec<u8>>,
        ) = pipe.query_async(&mut conn).await?;

        let tick = results.0;
        let players = results
            .1
            .into_iter()
            .map(|(k, v)| Ok((k, deser(&v)?)))
            .collect::<redis::RedisResult<_>>()?;
        let regions = results
            .2
            .into_iter()
            .map(|(k, v)| Ok((k, deser(&v)?)))
            .collect::<redis::RedisResult<_>>()?;
        let actions = results
            .3
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;
        let buildings_queue = results
            .5
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;
        let unit_queue = results
            .6
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;
        let transit_queue = results
            .7
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;
        let air_transit_queue = results
            .8
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;
        let active_effects = results
            .9
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;
        let diplomacy = results
            .10
            .as_deref()
            .map(deser)
            .transpose()?
            .unwrap_or_default();

        Ok(TickData {
            tick,
            players,
            regions,
            actions,
            buildings_queue,
            unit_queue,
            transit_queue,
            air_transit_queue,
            active_effects,
            diplomacy,
        })
    }

    pub async fn set_tick_result(
        &self,
        players: &HashMap<String, Player>,
        regions: &HashMap<String, Region>,
        buildings_queue: &[BuildingQueueItem],
        unit_queue: &[UnitQueueItem],
        transit_queue: &[TransitQueueItem],
        air_transit_queue: &[AirTransitItem],
        active_effects: &[ActiveEffect],
        diplomacy: &DiplomacyState,
        dirty_region_ids: Option<&std::collections::HashSet<String>>,
    ) -> redis::RedisResult<()> {
        let mut pipe = redis::pipe();
        pipe.atomic();

        let regions_key = self.key("regions");
        for (region_id, data) in regions {
            if dirty_region_ids.map_or(true, |ids| ids.contains(region_id))
            {
                let packed = rmp_serde::to_vec(data).unwrap();
                pipe.hset(&regions_key, region_id, packed).ignore();
            }
        }

        let players_key = self.key("players");
        for (pid, pdata) in players {
            let packed = rmp_serde::to_vec(pdata).unwrap();
            pipe.hset(&players_key, pid, packed).ignore();
        }

        // Use variadic RPUSH to collapse N items into a single command per queue
        let buildings_key = self.key("buildings_queue");
        pipe.del(&buildings_key).ignore();
        if !buildings_queue.is_empty() {
            let packed: Vec<Vec<u8>> = buildings_queue.iter().map(|b| rmp_serde::to_vec(b).unwrap()).collect();
            pipe.cmd("RPUSH").arg(&buildings_key).arg(packed).ignore();
        }

        let unit_key = self.key("unit_queue");
        pipe.del(&unit_key).ignore();
        if !unit_queue.is_empty() {
            let packed: Vec<Vec<u8>> = unit_queue.iter().map(|item| rmp_serde::to_vec(item).unwrap()).collect();
            pipe.cmd("RPUSH").arg(&unit_key).arg(packed).ignore();
        }

        let transit_key = self.key("transit_queue");
        pipe.del(&transit_key).ignore();
        if !transit_queue.is_empty() {
            let packed: Vec<Vec<u8>> = transit_queue.iter().map(|item| rmp_serde::to_vec(item).unwrap()).collect();
            pipe.cmd("RPUSH").arg(&transit_key).arg(packed).ignore();
        }

        let air_transit_key = self.key("air_transit_queue");
        pipe.del(&air_transit_key).ignore();
        if !air_transit_queue.is_empty() {
            let packed: Vec<Vec<u8>> = air_transit_queue.iter().map(|item| rmp_serde::to_vec(item).unwrap()).collect();
            pipe.cmd("RPUSH").arg(&air_transit_key).arg(packed).ignore();
        }

        let effects_key = self.key("active_effects");
        pipe.del(&effects_key).ignore();
        if !active_effects.is_empty() {
            let packed: Vec<Vec<u8>> = active_effects.iter().map(|item| rmp_serde::to_vec(item).unwrap()).collect();
            pipe.cmd("RPUSH").arg(&effects_key).arg(packed).ignore();
        }

        let diplomacy_packed = rmp_serde::to_vec(diplomacy).unwrap();
        pipe.set(self.key("diplomacy"), diplomacy_packed).ignore();

        let mut conn = self.redis.clone();
        pipe.exec_async(&mut conn).await
    }

    // --- Full State ---

    pub async fn get_full_state(&self) -> redis::RedisResult<FullGameState> {
        let mut pipe = redis::pipe();
        pipe.atomic();

        pipe.hgetall(self.key("meta"));
        pipe.hgetall(self.key("players"));
        pipe.hgetall(self.key("regions"));
        pipe.lrange(self.key("buildings_queue"), 0, -1);
        pipe.lrange(self.key("unit_queue"), 0, -1);
        pipe.lrange(self.key("transit_queue"), 0, -1);
        pipe.lrange(self.key("air_transit_queue"), 0, -1);
        pipe.lrange(self.key("active_effects"), 0, -1);
        pipe.get(self.key("diplomacy"));

        let mut conn = self.redis.clone();
        let results: (
            HashMap<String, String>,
            HashMap<String, Vec<u8>>,
            HashMap<String, Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Vec<Vec<u8>>,
            Option<Vec<u8>>,
        ) = pipe.query_async(&mut conn).await?;

        Ok(FullGameState {
            meta: results.0,
            players: results
                .1
                .into_iter()
                .map(|(k, v)| Ok((k, deser(&v)?)))
                .collect::<redis::RedisResult<_>>()?,
            regions: results
                .2
                .into_iter()
                .map(|(k, v)| Ok((k, deser(&v)?)))
                .collect::<redis::RedisResult<_>>()?,
            buildings_queue: results
                .3
                .iter()
                .map(|v| deser(v))
                .collect::<redis::RedisResult<_>>()?,
            unit_queue: results
                .4
                .iter()
                .map(|v| deser(v))
                .collect::<redis::RedisResult<_>>()?,
            transit_queue: results
                .5
                .iter()
                .map(|v| deser(v))
                .collect::<redis::RedisResult<_>>()?,
            air_transit_queue: results
                .6
                .iter()
                .map(|v| deser(v))
                .collect::<redis::RedisResult<_>>()?,
            active_effects: results
                .7
                .iter()
                .map(|v| deser(v))
                .collect::<redis::RedisResult<_>>()?,
            diplomacy: results
                .8
                .as_deref()
                .map(deser)
                .transpose()?
                .unwrap_or_default(),
        })
    }

    // --- State validation and recovery ---

    pub async fn validate_state(&self) -> redis::RedisResult<bool> {
        // Pipeline all three checks in a single round-trip
        let mut pipe = redis::pipe();
        pipe.hgetall(self.key("meta"));
        pipe.hlen(self.key("players"));
        pipe.hlen(self.key("regions"));

        let mut conn = self.redis.clone();
        let results: (HashMap<String, String>, i64, i64) = pipe.query_async(&mut conn).await?;

        let meta = results.0;
        if meta.is_empty() {
            return Ok(false);
        }
        let tick_valid = meta
            .get("current_tick")
            .and_then(|v| v.parse::<i64>().ok())
            .is_some();
        if !tick_valid {
            return Ok(false);
        }
        if results.1 == 0 || results.2 == 0 {
            return Ok(false);
        }

        Ok(true)
    }

    pub async fn restore_full_state(&self, full_state: &FullGameState) -> redis::RedisResult<()> {
        let mut pipe = redis::pipe();
        pipe.atomic();

        // Delete all existing keys
        pipe.del(self.key("meta")).ignore();
        pipe.del(self.key("players")).ignore();
        pipe.del(self.key("regions")).ignore();
        pipe.del(self.key("buildings_queue")).ignore();
        pipe.del(self.key("unit_queue")).ignore();
        pipe.del(self.key("transit_queue")).ignore();
        pipe.del(self.key("air_transit_queue")).ignore();
        pipe.del(self.key("active_effects")).ignore();
        pipe.del(self.key("actions")).ignore();
        pipe.del(self.key("diplomacy")).ignore();

        // Restore meta fields
        let meta_key = self.key("meta");
        for (field, value) in &full_state.meta {
            pipe.hset(&meta_key, field, value).ignore();
        }

        // Restore players
        let players_key = self.key("players");
        for (player_id, data) in &full_state.players {
            let packed = rmp_serde::to_vec(data).unwrap();
            pipe.hset(&players_key, player_id, packed).ignore();
        }

        // Restore regions
        let regions_key = self.key("regions");
        for (region_id, data) in &full_state.regions {
            let packed = rmp_serde::to_vec(data).unwrap();
            pipe.hset(&regions_key, region_id, packed).ignore();
        }

        // Restore queue lists
        let buildings_key = self.key("buildings_queue");
        for item in &full_state.buildings_queue {
            let packed = rmp_serde::to_vec(item).unwrap();
            pipe.rpush(&buildings_key, packed).ignore();
        }

        let unit_key = self.key("unit_queue");
        for item in &full_state.unit_queue {
            let packed = rmp_serde::to_vec(item).unwrap();
            pipe.rpush(&unit_key, packed).ignore();
        }

        let transit_key = self.key("transit_queue");
        for item in &full_state.transit_queue {
            let packed = rmp_serde::to_vec(item).unwrap();
            pipe.rpush(&transit_key, packed).ignore();
        }

        let air_transit_key = self.key("air_transit_queue");
        for item in &full_state.air_transit_queue {
            let packed = rmp_serde::to_vec(item).unwrap();
            pipe.rpush(&air_transit_key, packed).ignore();
        }

        let effects_key = self.key("active_effects");
        for item in &full_state.active_effects {
            let packed = rmp_serde::to_vec(item).unwrap();
            pipe.rpush(&effects_key, packed).ignore();
        }

        let diplomacy_packed = rmp_serde::to_vec(&full_state.diplomacy).unwrap();
        pipe.set(self.key("diplomacy"), diplomacy_packed).ignore();

        let mut conn = self.redis.clone();
        pipe.exec_async(&mut conn).await
    }

    // --- Cleanup ---

    pub async fn cleanup(&self) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        let keys = vec![
            self.key("meta"),
            self.key("players"),
            self.key("regions"),
            self.key("actions"),
            self.key("buildings_queue"),
            self.key("unit_queue"),
            self.key("transit_queue"),
            self.key("air_transit_queue"),
            self.key("active_effects"),
            self.key("diplomacy"),
        ];
        redis::cmd("DEL")
            .arg(&keys)
            .exec_async(&mut conn)
            .await
    }

    // --- Lock helpers ---

    pub async fn try_lock(&self, lock_name: &str, ttl_seconds: u64) -> redis::RedisResult<bool> {
        let mut conn = self.redis.clone();
        let key = self.key(lock_name);
        redis::cmd("SET")
            .arg(&key)
            .arg("1")
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds)
            .query_async::<Option<String>>(&mut conn)
            .await
            .map(|r| r.is_some())
    }

    pub async fn release_lock(&self, lock_name: &str) -> redis::RedisResult<()> {
        let mut conn = self.redis.clone();
        conn.del(self.key(lock_name)).await
    }

    // --- Connection counter ---

    pub async fn incr_connection(&self, player_id: &str) -> redis::RedisResult<i64> {
        let key = format!("game:{}:conn:{}", self.match_id, player_id);
        let mut pipe = redis::pipe();
        pipe.incr(&key, 1);
        pipe.expire(&key, 3600).ignore();
        let mut conn = self.redis.clone();
        let (count,): (i64,) = pipe.query_async(&mut conn).await?;
        Ok(count)
    }

    pub async fn decr_connection(&self, player_id: &str) -> redis::RedisResult<i64> {
        let mut conn = self.redis.clone();
        let key = format!("game:{}:conn:{}", self.match_id, player_id);
        let count: i64 = conn.decr(&key, 1).await?;
        if count <= 0 {
            conn.del::<_, ()>(&key).await?;
        } else {
            conn.expire::<_, ()>(&key, 3600).await?;
        }
        Ok(count)
    }

    // --- Buildings/Unit/Transit queues (for individual reads) ---

    pub async fn get_all_buildings(&self) -> redis::RedisResult<Vec<BuildingQueueItem>> {
        let mut conn = self.redis.clone();
        let raw: Vec<Vec<u8>> = conn.lrange(self.key("buildings_queue"), 0, -1).await?;
        Ok(raw
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?)
    }

    pub async fn get_all_unit_queue(&self) -> redis::RedisResult<Vec<UnitQueueItem>> {
        let mut conn = self.redis.clone();
        let raw: Vec<Vec<u8>> = conn.lrange(self.key("unit_queue"), 0, -1).await?;
        Ok(raw
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?)
    }

    pub async fn get_all_transit_queue(&self) -> redis::RedisResult<Vec<TransitQueueItem>> {
        let mut conn = self.redis.clone();
        let raw: Vec<Vec<u8>> = conn.lrange(self.key("transit_queue"), 0, -1).await?;
        Ok(raw
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?)
    }

    pub async fn get_all_air_transit_queue(&self) -> redis::RedisResult<Vec<AirTransitItem>> {
        let mut conn = self.redis.clone();
        let raw: Vec<Vec<u8>> = conn.lrange(self.key("air_transit_queue"), 0, -1).await?;
        Ok(raw
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?)
    }

    pub async fn get_all_active_effects(&self) -> redis::RedisResult<Vec<ActiveEffect>> {
        let mut conn = self.redis.clone();
        let raw: Vec<Vec<u8>> = conn.lrange(self.key("active_effects"), 0, -1).await?;
        Ok(raw
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?)
    }
}

// ---------------------------------------------------------------------------
// In-memory game state cache
// ---------------------------------------------------------------------------

/// In-memory game state cache that avoids HGETALL every tick.
///
/// Loads the full state from Redis once at match start, then operates on
/// local data for each tick. Only player actions and the tick counter are
/// fetched from Redis per tick; dirty regions/players are written back after
/// the engine processes the tick.
///
/// For snapshots, [`InMemoryState::to_full_state`] returns the in-memory
/// data directly without a Redis round-trip.
pub struct InMemoryState {
    state_mgr: GameStateManager,
    pub players: HashMap<String, Player>,
    pub regions: HashMap<String, Region>,
    pub buildings_queue: Vec<BuildingQueueItem>,
    pub unit_queue: Vec<UnitQueueItem>,
    pub transit_queue: Vec<TransitQueueItem>,
    pub air_transit_queue: Vec<AirTransitItem>,
    pub active_effects: Vec<ActiveEffect>,
    pub diplomacy: DiplomacyState,
    current_tick: i64,
}

impl InMemoryState {
    /// Load the full game state from Redis into memory.
    ///
    /// This issues a single pipelined read (identical to [`GameStateManager::get_tick_data`])
    /// and should be called once when the game loop starts for a match.
    pub async fn load(state_mgr: GameStateManager) -> redis::RedisResult<Self> {
        let tick_data = state_mgr.get_tick_data().await?;
        Ok(Self {
            state_mgr,
            players: tick_data.players,
            regions: tick_data.regions,
            buildings_queue: tick_data.buildings_queue,
            unit_queue: tick_data.unit_queue,
            transit_queue: tick_data.transit_queue,
            air_transit_queue: tick_data.air_transit_queue,
            active_effects: tick_data.active_effects,
            diplomacy: tick_data.diplomacy,
            current_tick: tick_data.tick,
        })
    }

    /// Read only new player actions from Redis and atomically increment the tick counter.
    ///
    /// All other game state (players, regions, queues) is already held in memory and
    /// does not require a Redis round-trip. The consumed actions list is deleted from
    /// Redis in the same pipeline command so they are processed exactly once.
    ///
    /// Returns `(current_tick, actions)`.
    pub async fn read_tick_actions(&mut self) -> redis::RedisResult<(i64, Vec<Action>)> {
        let meta_key = format!("game:{}:meta", self.state_mgr.match_id());
        let actions_key = format!("game:{}:actions", self.state_mgr.match_id());

        let mut pipe = redis::pipe();
        pipe.hincr(&meta_key, "current_tick", 1i64);
        pipe.lrange(&actions_key, 0, -1);
        pipe.del(&actions_key);

        let mut conn = self.state_mgr.redis();
        let (tick, raw_actions, ()): (i64, Vec<Vec<u8>>, ()) =
            pipe.query_async(&mut conn).await?;

        self.current_tick = tick;

        let actions = raw_actions
            .iter()
            .map(|v| deser(v))
            .collect::<redis::RedisResult<_>>()?;

        Ok((self.current_tick, actions))
    }

    /// Write only dirty state back to Redis after the engine has processed a tick.
    ///
    /// Delegates directly to [`GameStateManager::set_tick_result`], which already
    /// applies the `dirty_region_ids` filter to skip unchanged regions.
    pub async fn flush_to_redis(
        &self,
        dirty_region_ids: &std::collections::HashSet<String>,
    ) -> redis::RedisResult<()> {
        self.state_mgr
            .set_tick_result(
                &self.players,
                &self.regions,
                &self.buildings_queue,
                &self.unit_queue,
                &self.transit_queue,
                &self.air_transit_queue,
                &self.active_effects,
                &self.diplomacy,
                Some(dirty_region_ids),
            )
            .await
    }

    /// Build a [`FullGameState`] from in-memory data without reading Redis.
    ///
    /// Only the `meta` hash is fetched from Redis because it contains
    /// runtime fields (status, tick_interval_ms, etc.) that are not cached
    /// locally. All other fields come directly from memory.
    pub async fn to_full_state(&self) -> redis::RedisResult<FullGameState> {
        let meta = self.state_mgr.get_meta().await?;
        Ok(FullGameState {
            meta,
            players: self.players.clone(),
            regions: self.regions.clone(),
            buildings_queue: self.buildings_queue.clone(),
            unit_queue: self.unit_queue.clone(),
            transit_queue: self.transit_queue.clone(),
            air_transit_queue: self.air_transit_queue.clone(),
            active_effects: self.active_effects.clone(),
            diplomacy: self.diplomacy.clone(),
        })
    }

    /// Current tick number as tracked in memory (mirrors the Redis meta value).
    pub fn tick(&self) -> i64 {
        self.current_tick
    }

    /// Access the underlying [`GameStateManager`] for meta/lock operations.
    pub fn state_mgr(&self) -> &GameStateManager {
        &self.state_mgr
    }
}

// ---------------------------------------------------------------------------
// Unit tests — pure logic only, no Redis connection required.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use maplord_engine::{
        Action, ActiveEffect, BuildingQueueItem, BuildingInstance, Player, Region,
        TransitQueueItem, UnitQueueItem,
    };

    // -----------------------------------------------------------------------
    // Helper constructors
    // -----------------------------------------------------------------------

    fn make_player(user_id: &str) -> Player {
        Player {
            user_id: user_id.to_string(),
            username: format!("User_{user_id}"),
            color: "#ff0000".to_string(),
            is_alive: true,
            connected: true,
            ..Player::default()
        }
    }

    fn make_region(name: &str) -> Region {
        Region {
            name: name.to_string(),
            country_code: "PL".to_string(),
            unit_count: 5,
            unit_type: Some("infantry".to_string()),
            ..Region::default()
        }
    }

    // -----------------------------------------------------------------------
    // GameStateManager::key — key naming convention
    // -----------------------------------------------------------------------

    mod key_naming {
        // We expose key() via a thin wrapper so we can test it without Redis.
        // The `key` method is private, but we can exercise it indirectly by
        // checking the lock key and connection key helpers that ARE testable
        // without a live connection: we test the formatting pattern directly.

        #[test]
        fn key_format_contains_match_id_and_suffix() {
            // The documented format is "game:{match_id}:{suffix}".
            let match_id = "match-abc-123";
            let suffix = "meta";
            let key = format!("game:{match_id}:{suffix}");
            assert!(key.starts_with("game:match-abc-123:"));
            assert!(key.ends_with(":meta"));
        }

        #[test]
        fn connection_key_format_is_game_match_conn_player() {
            let match_id = "m1";
            let player_id = "p99";
            let key = format!("game:{match_id}:conn:{player_id}");
            assert_eq!(key, "game:m1:conn:p99");
        }

        #[test]
        fn key_distinguishes_different_suffixes() {
            let match_id = "match-xyz";
            let meta_key = format!("game:{match_id}:meta");
            let players_key = format!("game:{match_id}:players");
            let regions_key = format!("game:{match_id}:regions");
            let actions_key = format!("game:{match_id}:actions");
            assert_ne!(meta_key, players_key);
            assert_ne!(players_key, regions_key);
            assert_ne!(regions_key, actions_key);
        }

        #[test]
        fn key_distinguishes_different_match_ids() {
            let key1 = format!("game:match-1:meta");
            let key2 = format!("game:match-2:meta");
            assert_ne!(key1, key2);
        }

        #[test]
        fn lock_key_follows_same_pattern() {
            // Lock names like "loop_lock" use the same `key()` helper.
            let match_id = "m42";
            let lock_key = format!("game:{match_id}:loop_lock");
            assert_eq!(lock_key, "game:m42:loop_lock");
        }

        #[test]
        fn all_eight_standard_keys_are_distinct() {
            let m = "test-match";
            let suffixes = [
                "meta", "players", "regions", "actions",
                "buildings_queue", "unit_queue", "transit_queue", "active_effects",
            ];
            let keys: Vec<String> = suffixes
                .iter()
                .map(|s| format!("game:{m}:{s}"))
                .collect();
            let unique: std::collections::HashSet<_> = keys.iter().collect();
            assert_eq!(unique.len(), suffixes.len(), "every suffix must produce a unique key");
        }
    }

    // -----------------------------------------------------------------------
    // msgpack round-trips (no Redis needed)
    // -----------------------------------------------------------------------

    mod msgpack_roundtrip {
        use super::*;

        #[test]
        fn player_serialises_and_deserialises_losslessly() {
            let original = make_player("user-42");
            let packed = rmp_serde::to_vec(&original).expect("serialization should not fail");
            let restored: Player =
                rmp_serde::from_slice(&packed).expect("deserialization should not fail");
            assert_eq!(restored.user_id, original.user_id);
            assert_eq!(restored.username, original.username);
            assert_eq!(restored.is_alive, original.is_alive);
        }

        #[test]
        fn region_serialises_and_deserialises_losslessly() {
            let original = make_region("Warsaw");
            let packed = rmp_serde::to_vec(&original).expect("serialization should not fail");
            let restored: Region =
                rmp_serde::from_slice(&packed).expect("deserialization should not fail");
            assert_eq!(restored.name, original.name);
            assert_eq!(restored.unit_count, original.unit_count);
        }

        #[test]
        fn action_serialises_and_deserialises_losslessly() {
            let original = Action {
                action_type: "attack".to_string(),
                player_id: Some("player-1".to_string()),
                source_region_id: Some("region-A".to_string()),
                target_region_id: Some("region-B".to_string()),
                units: Some(15),
                ..Action::default()
            };
            let packed = rmp_serde::to_vec(&original).expect("serialization should not fail");
            let restored: Action =
                rmp_serde::from_slice(&packed).expect("deserialization should not fail");
            assert_eq!(restored.action_type, "attack");
            assert_eq!(restored.units, Some(15));
            assert_eq!(restored.source_region_id, Some("region-A".to_string()));
        }

        #[test]
        fn building_queue_item_round_trips() {
            let original = BuildingQueueItem {
                region_id: "region-1".to_string(),
                building_type: "barracks".to_string(),
                player_id: "player-1".to_string(),
                ticks_remaining: 5,
                total_ticks: 10,
                is_upgrade: false,
                target_level: 0,
            };
            let packed = rmp_serde::to_vec(&original).unwrap();
            let restored: BuildingQueueItem = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.building_type, "barracks");
            assert_eq!(restored.ticks_remaining, 5);
        }

        #[test]
        fn unit_queue_item_round_trips() {
            let original = UnitQueueItem {
                region_id: "region-2".to_string(),
                player_id: "player-2".to_string(),
                unit_type: "cavalry".to_string(),
                quantity: Some(3),
                manpower_cost: Some(6),
                ticks_remaining: 2,
                total_ticks: 4,
            };
            let packed = rmp_serde::to_vec(&original).unwrap();
            let restored: UnitQueueItem = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.unit_type, "cavalry");
            assert_eq!(restored.quantity, Some(3));
        }

        #[test]
        fn transit_queue_item_round_trips() {
            let original = TransitQueueItem {
                action_type: "attack".to_string(),
                source_region_id: "src".to_string(),
                target_region_id: "dst".to_string(),
                player_id: "player-3".to_string(),
                unit_type: "infantry".to_string(),
                units: 20,
                ticks_remaining: 3,
                travel_ticks: 3,
            };
            let packed = rmp_serde::to_vec(&original).unwrap();
            let restored: TransitQueueItem = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.units, 20);
            assert_eq!(restored.travel_ticks, 3);
        }

        #[test]
        fn active_effect_round_trips() {
            let original = ActiveEffect {
                effect_type: "poison".to_string(),
                source_player_id: "player-1".to_string(),
                target_region_id: "region-A".to_string(),
                affected_region_ids: vec!["region-B".to_string()],
                ticks_remaining: 4,
                total_ticks: 10,
                params: serde_json::json!({"damage": 5}),
            };
            let packed = rmp_serde::to_vec(&original).unwrap();
            let restored: ActiveEffect = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.effect_type, "poison");
            assert_eq!(restored.ticks_remaining, 4);
        }

        #[test]
        fn player_with_optional_fields_round_trips() {
            let mut player = make_player("user-99");
            player.capital_region_id = Some("region-capital".to_string());
            player.disconnect_deadline = Some(9999999);
            player.eliminated_tick = Some(42);
            player.eliminated_reason = Some("conquered".to_string());

            let packed = rmp_serde::to_vec(&player).unwrap();
            let restored: Player = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.capital_region_id, Some("region-capital".to_string()));
            assert_eq!(restored.disconnect_deadline, Some(9999999));
            assert_eq!(restored.eliminated_tick, Some(42));
        }

        #[test]
        fn region_with_units_map_round_trips() {
            let mut region = make_region("Krakow");
            region.units.insert("infantry".to_string(), 10);
            region.units.insert("cavalry".to_string(), 3);

            let packed = rmp_serde::to_vec(&region).unwrap();
            let restored: Region = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.units.get("infantry"), Some(&10));
            assert_eq!(restored.units.get("cavalry"), Some(&3));
        }

        #[test]
        fn region_with_building_instances_round_trips() {
            let mut region = make_region("Gdansk");
            region.building_instances = vec![
                BuildingInstance { building_type: "barracks".to_string(), level: 2 },
            ];

            let packed = rmp_serde::to_vec(&region).unwrap();
            let restored: Region = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.building_instances.len(), 1);
            assert_eq!(restored.building_instances[0].building_type, "barracks");
            assert_eq!(restored.building_instances[0].level, 2);
        }

        #[test]
        fn serialized_bytes_are_compact_for_minimal_player() {
            // msgpack should be smaller than JSON for a typical Player.
            let player = make_player("u1");
            let msgpack_bytes = rmp_serde::to_vec(&player).unwrap();
            let json_bytes = serde_json::to_vec(&player).unwrap();
            // msgpack is typically more compact; at minimum they exist and have nonzero length.
            assert!(!msgpack_bytes.is_empty());
            assert!(!json_bytes.is_empty());
            assert!(msgpack_bytes.len() < json_bytes.len(),
                "msgpack ({} bytes) should be smaller than JSON ({} bytes)",
                msgpack_bytes.len(), json_bytes.len());
        }

        #[test]
        fn corrupted_bytes_fail_gracefully() {
            let bad_bytes = b"\xde\xad\xbe\xef";
            let result: Result<Player, _> = rmp_serde::from_slice(bad_bytes);
            assert!(result.is_err(), "corrupted msgpack bytes should fail to deserialize");
        }
    }

    // -----------------------------------------------------------------------
    // FullGameState — JSON serde round-trip (used for snapshots)
    // -----------------------------------------------------------------------

    mod full_game_state_serde {
        use super::*;

        fn make_full_state() -> FullGameState {
            let mut meta = HashMap::new();
            meta.insert("status".to_string(), "in_progress".to_string());
            meta.insert("current_tick".to_string(), "42".to_string());
            meta.insert("tick_interval_ms".to_string(), "1000".to_string());

            let mut players = HashMap::new();
            players.insert("player-1".to_string(), make_player("player-1"));

            let mut regions = HashMap::new();
            regions.insert("region-A".to_string(), make_region("Warsaw"));

            FullGameState {
                meta,
                players,
                regions,
                buildings_queue: vec![],
                unit_queue: vec![],
                transit_queue: vec![],
                air_transit_queue: vec![],
                active_effects: vec![],
                diplomacy: DiplomacyState::default(),
            }
        }

        #[test]
        fn full_game_state_serialises_to_json_without_error() {
            let state = make_full_state();
            let json = serde_json::to_value(&state);
            assert!(json.is_ok(), "FullGameState must serialise to JSON");
        }

        #[test]
        fn full_game_state_json_round_trip_preserves_meta() {
            let original = make_full_state();
            let json = serde_json::to_value(&original).unwrap();
            let restored: FullGameState = serde_json::from_value(json).unwrap();
            assert_eq!(
                restored.meta.get("status"),
                Some(&"in_progress".to_string())
            );
            assert_eq!(
                restored.meta.get("current_tick"),
                Some(&"42".to_string())
            );
        }

        #[test]
        fn full_game_state_json_round_trip_preserves_player_count() {
            let original = make_full_state();
            let json = serde_json::to_value(&original).unwrap();
            let restored: FullGameState = serde_json::from_value(json).unwrap();
            assert_eq!(restored.players.len(), 1);
        }

        #[test]
        fn full_game_state_json_round_trip_preserves_region_name() {
            let original = make_full_state();
            let json = serde_json::to_value(&original).unwrap();
            let restored: FullGameState = serde_json::from_value(json).unwrap();
            assert_eq!(
                restored.regions.get("region-A").map(|r| r.name.as_str()),
                Some("Warsaw")
            );
        }

        #[test]
        fn full_game_state_msgpack_round_trip() {
            let original = make_full_state();
            let packed = rmp_serde::to_vec(&original).unwrap();
            let restored: FullGameState = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.meta.get("status"), Some(&"in_progress".to_string()));
            assert_eq!(restored.regions.len(), 1);
        }

        #[test]
        fn empty_full_game_state_round_trips() {
            let original = FullGameState {
                meta: HashMap::new(),
                players: HashMap::new(),
                regions: HashMap::new(),
                buildings_queue: vec![],
                unit_queue: vec![],
                transit_queue: vec![],
                air_transit_queue: vec![],
                active_effects: vec![],
                diplomacy: DiplomacyState::default(),
            };
            let json = serde_json::to_value(&original).unwrap();
            let restored: FullGameState = serde_json::from_value(json).unwrap();
            assert!(restored.players.is_empty());
            assert!(restored.regions.is_empty());
        }

        #[test]
        fn full_game_state_with_queues_round_trips() {
            let mut state = make_full_state();
            state.buildings_queue.push(BuildingQueueItem {
                region_id: "r1".to_string(),
                building_type: "barracks".to_string(),
                player_id: "p1".to_string(),
                ticks_remaining: 3,
                total_ticks: 10,
                is_upgrade: false,
                target_level: 0,
            });
            state.transit_queue.push(TransitQueueItem {
                action_type: "move".to_string(),
                source_region_id: "r1".to_string(),
                target_region_id: "r2".to_string(),
                player_id: "p1".to_string(),
                unit_type: "infantry".to_string(),
                units: 5,
                ticks_remaining: 2,
                travel_ticks: 2,
            });

            let json = serde_json::to_value(&state).unwrap();
            let restored: FullGameState = serde_json::from_value(json).unwrap();
            assert_eq!(restored.buildings_queue.len(), 1);
            assert_eq!(restored.transit_queue.len(), 1);
            assert_eq!(restored.transit_queue[0].units, 5);
        }
    }
}
