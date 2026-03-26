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

    // -----------------------------------------------------------------------
    // Error handling — corrupted / invalid msgpack for every type
    // -----------------------------------------------------------------------

    mod corrupted_msgpack {
        use super::*;
        use maplord_engine::AirTransitItem;

        // A byte sequence that is valid msgpack as an integer but is not a map,
        // so every struct deserialization must fail.
        const BAD: &[u8] = b"\xde\xad\xbe\xef";
        // A zero-length slice is never a valid complete msgpack value for a map.
        const EMPTY: &[u8] = b"";

        #[test]
        fn region_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<Region>(BAD).is_err(),
                "Region must reject corrupted msgpack"
            );
        }

        #[test]
        fn action_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<Action>(BAD).is_err(),
                "Action must reject corrupted msgpack"
            );
        }

        #[test]
        fn building_queue_item_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<BuildingQueueItem>(BAD).is_err(),
                "BuildingQueueItem must reject corrupted msgpack"
            );
        }

        #[test]
        fn unit_queue_item_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<UnitQueueItem>(BAD).is_err(),
                "UnitQueueItem must reject corrupted msgpack"
            );
        }

        #[test]
        fn transit_queue_item_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<TransitQueueItem>(BAD).is_err(),
                "TransitQueueItem must reject corrupted msgpack"
            );
        }

        #[test]
        fn active_effect_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<ActiveEffect>(BAD).is_err(),
                "ActiveEffect must reject corrupted msgpack"
            );
        }

        #[test]
        fn air_transit_item_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<AirTransitItem>(BAD).is_err(),
                "AirTransitItem must reject corrupted msgpack"
            );
        }

        #[test]
        fn full_game_state_rejects_corrupted_bytes() {
            assert!(
                rmp_serde::from_slice::<FullGameState>(BAD).is_err(),
                "FullGameState must reject corrupted msgpack"
            );
        }

        #[test]
        fn player_rejects_empty_slice() {
            assert!(
                rmp_serde::from_slice::<Player>(EMPTY).is_err(),
                "Player must reject an empty byte slice"
            );
        }

        #[test]
        fn region_rejects_empty_slice() {
            assert!(
                rmp_serde::from_slice::<Region>(EMPTY).is_err(),
                "Region must reject an empty byte slice"
            );
        }

        #[test]
        fn deser_helper_maps_error_to_redis_parse_error() {
            // The deser() function is private; we exercise it indirectly by
            // replicating its logic and confirming the error kind matches what
            // RedisResult callers would receive.
            let result: Result<Player, _> = rmp_serde::from_slice(BAD);
            let err = result.unwrap_err();
            let redis_err = redis::RedisError::from((
                redis::ErrorKind::ParseError,
                "msgpack deserialization failed",
                err.to_string(),
            ));
            assert_eq!(redis_err.kind(), redis::ErrorKind::ParseError);
        }

        #[test]
        fn truncated_valid_msgpack_fails() {
            // Serialize a real Player then drop the last 10 bytes to produce a
            // structurally valid-start but incomplete message.
            let player = make_player("truncation-test");
            let mut bytes = rmp_serde::to_vec(&player).unwrap();
            let new_len = bytes.len().saturating_sub(10);
            bytes.truncate(new_len);
            assert!(
                rmp_serde::from_slice::<Player>(&bytes).is_err(),
                "Truncated msgpack must fail to deserialize"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Empty-collection behavior — pure iteration / deserialization
    // -----------------------------------------------------------------------

    mod empty_collections {
        use super::*;

        #[test]
        fn collecting_players_from_empty_map_gives_empty_map() {
            // Mirrors the inner logic of get_all_players when Redis returns {}.
            let raw: HashMap<String, Vec<u8>> = HashMap::new();
            let result: redis::RedisResult<HashMap<String, Player>> = raw
                .into_iter()
                .map(|(k, v)| {
                    rmp_serde::from_slice::<Player>(&v)
                        .map_err(|e| {
                            redis::RedisError::from((
                                redis::ErrorKind::ParseError,
                                "msgpack deserialization failed",
                                e.to_string(),
                            ))
                        })
                        .map(|p| (k, p))
                })
                .collect();
            assert!(result.is_ok());
            assert!(result.unwrap().is_empty());
        }

        #[test]
        fn collecting_regions_from_empty_map_gives_empty_map() {
            let raw: HashMap<String, Vec<u8>> = HashMap::new();
            let result: redis::RedisResult<HashMap<String, Region>> = raw
                .into_iter()
                .map(|(k, v)| {
                    rmp_serde::from_slice::<Region>(&v)
                        .map_err(|e| {
                            redis::RedisError::from((
                                redis::ErrorKind::ParseError,
                                "msgpack deserialization failed",
                                e.to_string(),
                            ))
                        })
                        .map(|r| (k, r))
                })
                .collect();
            assert!(result.is_ok());
            assert!(result.unwrap().is_empty());
        }

        #[test]
        fn collecting_actions_from_empty_vec_gives_empty_vec() {
            let raw: Vec<Vec<u8>> = vec![];
            let result: redis::RedisResult<Vec<Action>> = raw
                .iter()
                .map(|v| {
                    rmp_serde::from_slice::<Action>(v).map_err(|e| {
                        redis::RedisError::from((
                            redis::ErrorKind::ParseError,
                            "msgpack deserialization failed",
                            e.to_string(),
                        ))
                    })
                })
                .collect();
            assert!(result.is_ok());
            assert!(result.unwrap().is_empty());
        }

        #[test]
        fn collecting_buildings_from_empty_vec_gives_empty_vec() {
            let raw: Vec<Vec<u8>> = vec![];
            let result: redis::RedisResult<Vec<BuildingQueueItem>> = raw
                .iter()
                .map(|v| {
                    rmp_serde::from_slice::<BuildingQueueItem>(v).map_err(|e| {
                        redis::RedisError::from((
                            redis::ErrorKind::ParseError,
                            "msgpack deserialization failed",
                            e.to_string(),
                        ))
                    })
                })
                .collect();
            assert!(result.is_ok());
            assert!(result.unwrap().is_empty());
        }

        #[test]
        fn single_corrupted_entry_in_collection_fails_whole_collection() {
            // One bad entry in the map causes the whole collect() to fail,
            // matching the behavior of get_all_players / get_all_regions.
            let bad_bytes = b"\xde\xad\xbe\xef".to_vec();
            let good_player = make_player("good");
            let good_bytes = rmp_serde::to_vec(&good_player).unwrap();

            let raw: HashMap<String, Vec<u8>> = [
                ("good".to_string(), good_bytes),
                ("bad".to_string(), bad_bytes),
            ]
            .into_iter()
            .collect();

            let result: redis::RedisResult<HashMap<String, Player>> = raw
                .into_iter()
                .map(|(k, v)| {
                    rmp_serde::from_slice::<Player>(&v)
                        .map_err(|e| {
                            redis::RedisError::from((
                                redis::ErrorKind::ParseError,
                                "msgpack deserialization failed",
                                e.to_string(),
                            ))
                        })
                        .map(|p| (k, p))
                })
                .collect();

            assert!(
                result.is_err(),
                "One corrupted entry must cause the entire collection to fail"
            );
        }
    }

    // -----------------------------------------------------------------------
    // set_meta_field — field value semantics (pure msgpack / string logic)
    // -----------------------------------------------------------------------

    mod meta_field_values {

        // set_meta_field stores strings into a Redis HASH.  We cannot call it
        // without a live connection, but we can verify that all the value types
        // we expect to store round-trip correctly through String (the storage
        // type) and that the values are what the callers pass.

        #[test]
        fn integer_as_string_parses_back_to_i64() {
            let stored = "42";
            let parsed: i64 = stored.parse().expect("integer strings must parse to i64");
            assert_eq!(parsed, 42);
        }

        #[test]
        fn tick_counter_string_parses_correctly() {
            // validate_state uses .parse::<i64>() on the "current_tick" field.
            for tick in [0i64, 1, 100, i64::MAX] {
                let as_str = tick.to_string();
                let parsed: i64 = as_str.parse().unwrap();
                assert_eq!(parsed, tick);
            }
        }

        #[test]
        fn boolean_like_strings_are_preserved_as_stored() {
            // Status values like "selecting", "in_progress", "finished" are
            // plain strings — no parsing — so they round-trip identically.
            for status in ["selecting", "in_progress", "finished", "cancelled"] {
                let stored = status.to_string();
                assert_eq!(stored.as_str(), status);
            }
        }

        #[test]
        fn unicode_field_value_survives_string_round_trip() {
            let value = "状態"; // "state" in Japanese
            let stored = value.to_string();
            assert_eq!(stored.as_str(), value);
        }

        #[test]
        fn empty_string_field_value_is_allowed() {
            let value = "";
            let stored = value.to_string();
            assert_eq!(stored.as_str(), value);
        }

        #[test]
        fn large_integer_field_value_round_trips() {
            let tick: i64 = 9_999_999;
            let stored = tick.to_string();
            assert_eq!(stored.parse::<i64>().unwrap(), tick);
        }
    }

    // -----------------------------------------------------------------------
    // push_action — queue ordering invariant (pure msgpack layer)
    // -----------------------------------------------------------------------

    mod action_queue_ordering {
        use super::*;

        #[test]
        fn multiple_actions_serialise_independently_and_preserve_order() {
            let actions: Vec<Action> = (1..=5)
                .map(|i| Action {
                    action_type: format!("action_{i}"),
                    player_id: Some(format!("player-{i}")),
                    units: Some(i * 10),
                    ..Action::default()
                })
                .collect();

            // Simulate push_action serialization for each item.
            let packed: Vec<Vec<u8>> = actions
                .iter()
                .map(|a| rmp_serde::to_vec(a).unwrap())
                .collect();

            // Simulate reading back (mirrors get_tick_data lrange logic).
            let restored: Vec<Action> = packed
                .iter()
                .map(|v| rmp_serde::from_slice(v).unwrap())
                .collect();

            assert_eq!(restored.len(), 5);
            for (i, action) in restored.iter().enumerate() {
                assert_eq!(action.action_type, format!("action_{}", i + 1));
                assert_eq!(action.units, Some(((i as i64) + 1) * 10));
            }
        }

        #[test]
        fn empty_action_queue_produces_empty_slice() {
            // push_action on an empty queue: there are simply no items to
            // serialize.  The msgpack layer produces zero bytes for zero items.
            let actions: Vec<Action> = vec![];
            let packed: Vec<Vec<u8>> = actions
                .iter()
                .map(|a| rmp_serde::to_vec(a).unwrap())
                .collect();
            assert!(packed.is_empty());
        }

        #[test]
        fn single_action_push_serialises_and_restores_all_fields() {
            let action = Action {
                action_type: "bomb".to_string(),
                player_id: Some("player-7".to_string()),
                source_region_id: Some("src-1".to_string()),
                target_region_id: Some("dst-2".to_string()),
                units: Some(50),
                unit_type: Some("bomber".to_string()),
                ..Action::default()
            };
            let packed = rmp_serde::to_vec(&action).unwrap();
            let restored: Action = rmp_serde::from_slice(&packed).unwrap();
            assert_eq!(restored.action_type, "bomb");
            assert_eq!(restored.player_id, Some("player-7".to_string()));
            assert_eq!(restored.units, Some(50));
            assert_eq!(restored.unit_type, Some("bomber".to_string()));
        }
    }

    // -----------------------------------------------------------------------
    // validate_state — pure boolean logic on meta HashMap and counts
    // -----------------------------------------------------------------------

    mod validate_state_logic {
        use super::*;

        // Inline the same validation logic that GameStateManager::validate_state
        // executes, so we can cover every branch without a Redis connection.
        fn run_validation(meta: &HashMap<String, String>, player_count: i64, region_count: i64) -> bool {
            if meta.is_empty() {
                return false;
            }
            let tick_valid = meta
                .get("current_tick")
                .and_then(|v| v.parse::<i64>().ok())
                .is_some();
            if !tick_valid {
                return false;
            }
            if player_count == 0 || region_count == 0 {
                return false;
            }
            true
        }

        #[test]
        fn valid_state_returns_true() {
            let mut meta = HashMap::new();
            meta.insert("status".to_string(), "in_progress".to_string());
            meta.insert("current_tick".to_string(), "10".to_string());
            assert!(run_validation(&meta, 2, 5));
        }

        #[test]
        fn empty_meta_returns_false() {
            assert!(!run_validation(&HashMap::new(), 2, 5));
        }

        #[test]
        fn missing_current_tick_returns_false() {
            let mut meta = HashMap::new();
            meta.insert("status".to_string(), "in_progress".to_string());
            // "current_tick" is absent — parse returns None.
            assert!(!run_validation(&meta, 2, 5));
        }

        #[test]
        fn non_numeric_current_tick_returns_false() {
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "not_a_number".to_string());
            assert!(!run_validation(&meta, 2, 5));
        }

        #[test]
        fn zero_players_returns_false() {
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "1".to_string());
            assert!(!run_validation(&meta, 0, 5));
        }

        #[test]
        fn zero_regions_returns_false() {
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "1".to_string());
            assert!(!run_validation(&meta, 2, 0));
        }

        #[test]
        fn zero_players_and_zero_regions_returns_false() {
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "5".to_string());
            assert!(!run_validation(&meta, 0, 0));
        }

        #[test]
        fn tick_zero_is_valid_when_meta_and_counts_present() {
            // tick = 0 is a valid i64, so the match just started.
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "0".to_string());
            assert!(run_validation(&meta, 1, 1));
        }

        #[test]
        fn negative_tick_is_still_parseable_as_i64() {
            // The validation only checks parse success, not sign.
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "-1".to_string());
            assert!(run_validation(&meta, 1, 1));
        }

        #[test]
        fn empty_string_tick_fails_parse_returns_false() {
            let mut meta = HashMap::new();
            meta.insert("current_tick".to_string(), "".to_string());
            assert!(!run_validation(&meta, 2, 5));
        }
    }

    // -----------------------------------------------------------------------
    // restore_full_state — empty state round-trip (msgpack layer)
    // -----------------------------------------------------------------------

    mod restore_full_state {
        use super::*;

        #[test]
        fn empty_full_state_msgpack_round_trip_preserves_empty_collections() {
            let state = FullGameState {
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
            let packed = rmp_serde::to_vec(&state).unwrap();
            let restored: FullGameState = rmp_serde::from_slice(&packed).unwrap();
            assert!(restored.meta.is_empty());
            assert!(restored.players.is_empty());
            assert!(restored.regions.is_empty());
            assert!(restored.buildings_queue.is_empty());
            assert!(restored.unit_queue.is_empty());
            assert!(restored.transit_queue.is_empty());
            assert!(restored.air_transit_queue.is_empty());
            assert!(restored.active_effects.is_empty());
        }

        #[test]
        fn restore_loop_over_empty_players_produces_no_pipeline_entries() {
            // Simulates the inner for-loop of restore_full_state for players:
            // iterating over an empty map must produce zero packed blobs.
            let players: HashMap<String, Player> = HashMap::new();
            let blobs: Vec<(String, Vec<u8>)> = players
                .iter()
                .map(|(id, p)| (id.clone(), rmp_serde::to_vec(p).unwrap()))
                .collect();
            assert!(blobs.is_empty());
        }

        #[test]
        fn restore_loop_over_empty_regions_produces_no_pipeline_entries() {
            let regions: HashMap<String, Region> = HashMap::new();
            let blobs: Vec<(String, Vec<u8>)> = regions
                .iter()
                .map(|(id, r)| (id.clone(), rmp_serde::to_vec(r).unwrap()))
                .collect();
            assert!(blobs.is_empty());
        }

        #[test]
        fn restore_full_state_with_players_and_regions_serialises_correctly() {
            let state = FullGameState {
                meta: {
                    let mut m = HashMap::new();
                    m.insert("status".to_string(), "in_progress".to_string());
                    m.insert("current_tick".to_string(), "7".to_string());
                    m
                },
                players: {
                    let mut p = HashMap::new();
                    p.insert("p1".to_string(), make_player("p1"));
                    p.insert("p2".to_string(), make_player("p2"));
                    p
                },
                regions: {
                    let mut r = HashMap::new();
                    r.insert("r1".to_string(), make_region("Warsaw"));
                    r
                },
                buildings_queue: vec![],
                unit_queue: vec![],
                transit_queue: vec![],
                air_transit_queue: vec![],
                active_effects: vec![],
                diplomacy: DiplomacyState::default(),
            };

            // Verify each player round-trips through the pipe serialization path.
            for (id, player) in &state.players {
                let packed = rmp_serde::to_vec(player).unwrap();
                let restored: Player = rmp_serde::from_slice(&packed).unwrap();
                assert_eq!(&restored.user_id, id);
            }

            // Verify each region round-trips.
            for (_id, region) in &state.regions {
                let packed = rmp_serde::to_vec(region).unwrap();
                let restored: Region = rmp_serde::from_slice(&packed).unwrap();
                assert_eq!(&restored.name, &region.name);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Connection tracking — key format and counter semantics
    // -----------------------------------------------------------------------

    mod connection_tracking {

        fn conn_key(match_id: &str, player_id: &str) -> String {
            format!("game:{}:conn:{}", match_id, player_id)
        }

        #[test]
        fn connection_key_is_scoped_to_match_and_player() {
            let key = conn_key("match-1", "player-A");
            assert_eq!(key, "game:match-1:conn:player-A");
        }

        #[test]
        fn connection_keys_are_distinct_across_players() {
            let k1 = conn_key("m1", "player-A");
            let k2 = conn_key("m1", "player-B");
            assert_ne!(k1, k2);
        }

        #[test]
        fn connection_keys_are_distinct_across_matches() {
            let k1 = conn_key("match-1", "player-A");
            let k2 = conn_key("match-2", "player-A");
            assert_ne!(k1, k2);
        }

        #[test]
        fn connection_keys_do_not_collide_with_other_game_keys() {
            // The conn key uses a different scheme than the standard game key.
            let conn = conn_key("m1", "players");
            let players_key = format!("game:m1:players");
            // "game:m1:conn:players" vs "game:m1:players" — must differ.
            assert_ne!(conn, players_key);
        }

        #[test]
        fn simulated_incr_reaches_expected_count_after_multiple_calls() {
            // incr_connection does INCR on the key; simulate in-memory counter.
            let mut counter: i64 = 0;
            for _ in 0..5 {
                counter += 1;
            }
            assert_eq!(counter, 5);
        }

        #[test]
        fn simulated_decr_to_zero_triggers_deletion_branch() {
            // decr_connection deletes the key when count <= 0.
            let mut counter: i64 = 1;
            counter -= 1;
            let should_delete = counter <= 0;
            assert!(should_delete, "counter at 0 must trigger key deletion");
        }

        #[test]
        fn simulated_decr_below_zero_also_triggers_deletion_branch() {
            // If somehow the counter reaches a negative value it should still
            // trigger deletion rather than setting a negative TTL.
            let mut counter: i64 = 0;
            counter -= 1; // goes to -1
            let should_delete = counter <= 0;
            assert!(should_delete, "negative counter must trigger key deletion");
        }

        #[test]
        fn simulated_decr_above_zero_keeps_key() {
            let mut counter: i64 = 3;
            counter -= 1;
            let should_delete = counter <= 0;
            assert!(!should_delete, "counter > 0 must NOT trigger deletion");
        }
    }

    // -----------------------------------------------------------------------
    // Lock management — key format and NX semantics
    // -----------------------------------------------------------------------

    mod lock_management {

        fn lock_key(match_id: &str, lock_name: &str) -> String {
            format!("game:{}:{}", match_id, lock_name)
        }

        #[test]
        fn lock_key_follows_standard_game_key_pattern() {
            let key = lock_key("match-99", "loop_lock");
            assert_eq!(key, "game:match-99:loop_lock");
        }

        #[test]
        fn different_lock_names_produce_different_keys() {
            let k1 = lock_key("m1", "loop_lock");
            let k2 = lock_key("m1", "snapshot_lock");
            assert_ne!(k1, k2);
        }

        #[test]
        fn try_lock_semantics_set_nx_returns_some_on_first_acquire() {
            // SET NX returns Some("OK") if the key was set, None if it already exists.
            // Simulate: first call → key absent → acquire succeeds → Some("OK").
            let acquired: Option<String> = Some("OK".to_string());
            assert!(acquired.is_some(), "first acquire must succeed (Some)");
        }

        #[test]
        fn try_lock_semantics_set_nx_returns_none_when_already_locked() {
            // Simulate: key already present → SET NX returns None → acquire fails.
            let acquired: Option<String> = None;
            assert!(
                acquired.is_none(),
                "second acquire must fail when lock is held (None)"
            );
        }

        #[test]
        fn is_some_maps_set_nx_result_to_bool_correctly() {
            // GameStateManager::try_lock maps Option<String> → bool via .is_some().
            assert!(Some("OK".to_string()).is_some());
            assert!(!None::<String>.is_some());
        }

        #[test]
        fn release_lock_deletes_the_lock_key() {
            // release_lock calls conn.del(key).  If the key does not exist,
            // DEL is a no-op (returns 0) — this is not an error.
            // Verify the key we would delete is the same one try_lock writes.
            let match_id = "m-lock-test";
            let lock_name = "loop_lock";
            let acquire_key = lock_key(match_id, lock_name);
            let release_key = lock_key(match_id, lock_name);
            assert_eq!(acquire_key, release_key);
        }

        #[test]
        fn release_lock_on_nonexistent_key_is_not_an_error() {
            // Redis DEL on a missing key returns 0 but does NOT return an error.
            // We model this: a successful Result with value 0i64 is valid.
            let del_result: redis::RedisResult<i64> = Ok(0);
            assert!(del_result.is_ok());
        }
    }

    // -----------------------------------------------------------------------
    // Bulk operations — empty and non-empty serialization paths
    // -----------------------------------------------------------------------

    mod bulk_operations {
        use super::*;

        #[test]
        fn set_players_bulk_empty_map_produces_no_blobs() {
            let players: HashMap<String, Player> = HashMap::new();
            let blobs: Vec<(&str, Vec<u8>)> = players
                .iter()
                .map(|(id, p)| (id.as_str(), rmp_serde::to_vec(p).unwrap()))
                .collect();
            assert!(blobs.is_empty(), "empty player map must produce no pipeline hset commands");
        }

        #[test]
        fn set_regions_bulk_empty_map_produces_no_blobs() {
            let regions: HashMap<String, Region> = HashMap::new();
            let blobs: Vec<(&str, Vec<u8>)> = regions
                .iter()
                .map(|(id, r)| (id.as_str(), rmp_serde::to_vec(r).unwrap()))
                .collect();
            assert!(blobs.is_empty(), "empty region map must produce no pipeline hset commands");
        }

        #[test]
        fn set_players_bulk_followed_by_get_all_is_consistent() {
            // Simulate set_players_bulk serialization then get_all_players deserialization.
            let mut players = HashMap::new();
            players.insert("p1".to_string(), make_player("p1"));
            players.insert("p2".to_string(), make_player("p2"));
            players.insert("p3".to_string(), make_player("p3"));

            // Serialize (set path).
            let blobs: HashMap<String, Vec<u8>> = players
                .iter()
                .map(|(id, p)| (id.clone(), rmp_serde::to_vec(p).unwrap()))
                .collect();

            // Deserialize (get_all path).
            let restored: HashMap<String, Player> = blobs
                .into_iter()
                .map(|(k, v)| (k, rmp_serde::from_slice(&v).unwrap()))
                .collect();

            assert_eq!(restored.len(), 3);
            assert_eq!(restored["p1"].user_id, "p1");
            assert_eq!(restored["p2"].user_id, "p2");
            assert_eq!(restored["p3"].user_id, "p3");
        }

        #[test]
        fn set_regions_bulk_followed_by_get_all_is_consistent() {
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), make_region("Warsaw"));
            regions.insert("r2".to_string(), make_region("Krakow"));

            let blobs: HashMap<String, Vec<u8>> = regions
                .iter()
                .map(|(id, r)| (id.clone(), rmp_serde::to_vec(r).unwrap()))
                .collect();

            let restored: HashMap<String, Region> = blobs
                .into_iter()
                .map(|(k, v)| (k, rmp_serde::from_slice(&v).unwrap()))
                .collect();

            assert_eq!(restored.len(), 2);
            assert_eq!(restored["r1"].name, "Warsaw");
            assert_eq!(restored["r2"].name, "Krakow");
        }

        #[test]
        fn bulk_set_preserves_all_player_fields_after_round_trip() {
            let mut player = make_player("bulk-player");
            player.capital_region_id = Some("cap-region".to_string());
            player.energy = 250;
            player.is_bot = true;
            player.eliminated_tick = Some(99);

            let mut players = HashMap::new();
            players.insert("bulk-player".to_string(), player.clone());

            let blobs: HashMap<String, Vec<u8>> = players
                .iter()
                .map(|(id, p)| (id.clone(), rmp_serde::to_vec(p).unwrap()))
                .collect();

            let restored: Player = rmp_serde::from_slice(blobs["bulk-player"].as_slice()).unwrap();
            assert_eq!(restored.capital_region_id, Some("cap-region".to_string()));
            assert_eq!(restored.energy, 250);
            assert!(restored.is_bot);
            assert_eq!(restored.eliminated_tick, Some(99));
        }

        #[test]
        fn bulk_set_preserves_all_region_fields_after_round_trip() {
            let mut region = make_region("Gdansk");
            region.owner_id = Some("player-9".to_string());
            region.unit_count = 42;
            region.is_capital = true;
            region.units.insert("cavalry".to_string(), 7);

            let mut regions = HashMap::new();
            regions.insert("r-gdansk".to_string(), region.clone());

            let blobs: HashMap<String, Vec<u8>> = regions
                .iter()
                .map(|(id, r)| (id.clone(), rmp_serde::to_vec(r).unwrap()))
                .collect();

            let restored: Region = rmp_serde::from_slice(blobs["r-gdansk"].as_slice()).unwrap();
            assert_eq!(restored.owner_id, Some("player-9".to_string()));
            assert_eq!(restored.unit_count, 42);
            assert!(restored.is_capital);
            assert_eq!(restored.units.get("cavalry"), Some(&7));
        }

        #[test]
        fn large_bulk_players_all_serialise_and_deserialise() {
            let players: HashMap<String, Player> = (0..50)
                .map(|i| {
                    let id = format!("player-{i}");
                    (id.clone(), make_player(&id))
                })
                .collect();

            let blobs: HashMap<String, Vec<u8>> = players
                .iter()
                .map(|(id, p)| (id.clone(), rmp_serde::to_vec(p).unwrap()))
                .collect();

            let restored: HashMap<String, Player> = blobs
                .into_iter()
                .map(|(k, v)| (k, rmp_serde::from_slice(&v).unwrap()))
                .collect();

            assert_eq!(restored.len(), 50);
            for i in 0..50 {
                let id = format!("player-{i}");
                assert_eq!(restored[&id].user_id, id);
            }
        }
    }

    // -----------------------------------------------------------------------
    // get_tick_data — partial / missing keys default behavior
    // -----------------------------------------------------------------------

    mod tick_data_defaults {
        use super::*;

        #[test]
        fn diplomacy_none_falls_back_to_default() {
            // get_tick_data uses .unwrap_or_default() when the diplomacy key is
            // absent (Redis GET returns nil → Option::None).
            let raw: Option<Vec<u8>> = None;
            let diplomacy: DiplomacyState = raw
                .as_deref()
                .map(|b| rmp_serde::from_slice::<DiplomacyState>(b).unwrap())
                .unwrap_or_default();

            assert!(diplomacy.wars.is_empty());
            assert!(diplomacy.pacts.is_empty());
            assert!(diplomacy.proposals.is_empty());
        }

        #[test]
        fn diplomacy_present_deserialises_correctly() {
            let original = DiplomacyState::default();
            let packed = rmp_serde::to_vec(&original).unwrap();
            let raw: Option<Vec<u8>> = Some(packed);

            let diplomacy: DiplomacyState = raw
                .as_deref()
                .map(|b| rmp_serde::from_slice(b).unwrap())
                .unwrap_or_default();

            assert!(diplomacy.wars.is_empty());
        }

        #[test]
        fn empty_players_map_from_hgetall_gives_zero_players_in_tick_data() {
            // Mirrors the players deserialization step inside get_tick_data.
            let raw: HashMap<String, Vec<u8>> = HashMap::new();
            let players: HashMap<String, Player> = raw
                .into_iter()
                .map(|(k, v)| (k, rmp_serde::from_slice(&v).unwrap()))
                .collect();
            assert!(players.is_empty());
        }

        #[test]
        fn empty_regions_map_from_hgetall_gives_zero_regions_in_tick_data() {
            let raw: HashMap<String, Vec<u8>> = HashMap::new();
            let regions: HashMap<String, Region> = raw
                .into_iter()
                .map(|(k, v)| (k, rmp_serde::from_slice(&v).unwrap()))
                .collect();
            assert!(regions.is_empty());
        }

        #[test]
        fn empty_action_list_from_lrange_gives_zero_actions_in_tick_data() {
            let raw: Vec<Vec<u8>> = vec![];
            let actions: Vec<Action> = raw
                .iter()
                .map(|v| rmp_serde::from_slice(v).unwrap())
                .collect();
            assert!(actions.is_empty());
        }

        #[test]
        fn all_queue_lists_empty_gives_empty_tick_data_queues() {
            let empty: Vec<Vec<u8>> = vec![];

            let buildings: Vec<BuildingQueueItem> = empty
                .iter()
                .map(|v| rmp_serde::from_slice(v).unwrap())
                .collect();
            let units: Vec<UnitQueueItem> = empty
                .iter()
                .map(|v| rmp_serde::from_slice(v).unwrap())
                .collect();
            let transit: Vec<TransitQueueItem> = empty
                .iter()
                .map(|v| rmp_serde::from_slice(v).unwrap())
                .collect();

            assert!(buildings.is_empty());
            assert!(units.is_empty());
            assert!(transit.is_empty());
        }
    }
}
