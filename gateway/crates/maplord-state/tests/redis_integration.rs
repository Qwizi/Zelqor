// Redis integration tests for maplord-state.
//
// These tests require a live Redis instance. They are gated with `#[ignore]`
// so the normal `cargo test` run skips them. To run them:
//
//   cargo test -p maplord-state -- --include-ignored
//
// Override the Redis URL via the `REDIS_URL` environment variable.
// The tests use database 15 by default to avoid interfering with other data.

use maplord_engine::{
    Action, ActiveEffect, AirTransitItem, BuildingQueueItem, DiplomacyState, Player, Region,
    TransitQueueItem, UnitQueueItem,
};
use maplord_state::{FullGameState, GameStateManager};
use redis::aio::ConnectionManager;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async fn make_manager() -> (GameStateManager, String) {
    let url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379/15".into());
    let match_id = uuid::Uuid::new_v4().to_string();
    let client = redis::Client::open(url).expect("valid Redis URL");
    let conn = ConnectionManager::new(client)
        .await
        .expect("Redis connection failed — is Redis running?");
    let manager = GameStateManager::new(match_id.clone(), conn);
    (manager, match_id)
}

fn make_player(user_id: &str) -> Player {
    Player {
        user_id: user_id.to_string(),
        username: format!("user_{user_id}"),
        color: "#ff0000".to_string(),
        is_alive: true,
        energy: 100,
        action_points: 15,
        ..Default::default()
    }
}

fn make_region(name: &str) -> Region {
    Region {
        name: name.to_string(),
        unit_count: 5,
        ..Default::default()
    }
}

fn make_action(player_id: &str, action_type: &str) -> Action {
    Action {
        action_type: action_type.to_string(),
        player_id: Some(player_id.to_string()),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// 1. GameStateManager::new — connects successfully
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_new_connects() {
    let (manager, _) = make_manager().await;
    // If we got here without panicking the connection succeeded.
    // Do a smoke-check by reading an empty meta hash.
    let meta = manager.get_meta().await.expect("get_meta failed");
    assert!(meta.is_empty());
    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 2. init_meta + get_meta round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_init_meta_and_get_meta() {
    let (manager, _) = make_manager().await;

    manager
        .init_meta(1000, 4)
        .await
        .expect("init_meta failed");

    let meta = manager.get_meta().await.expect("get_meta failed");
    assert_eq!(meta.get("status").map(String::as_str), Some("selecting"));
    assert_eq!(meta.get("current_tick").map(String::as_str), Some("0"));
    assert_eq!(meta.get("tick_interval_ms").map(String::as_str), Some("1000"));
    assert_eq!(meta.get("max_players").map(String::as_str), Some("4"));

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 3. set_meta_field + get_meta — field updated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_meta_field_updates_value() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_meta_field("status", "active")
        .await
        .expect("set_meta_field failed");

    let meta = manager.get_meta().await.expect("get_meta failed");
    assert_eq!(meta.get("status").map(String::as_str), Some("active"));

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 4. set_player + get_player round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_and_get_player() {
    let (manager, _) = make_manager().await;

    let player = make_player("player1");
    manager
        .set_player("player1", &player)
        .await
        .expect("set_player failed");

    let retrieved = manager
        .get_player("player1")
        .await
        .expect("get_player failed")
        .expect("player should exist");

    assert_eq!(retrieved.user_id, "player1");
    assert_eq!(retrieved.username, "user_player1");
    assert_eq!(retrieved.energy, 100);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 5. get_all_players with multiple players
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_players_multiple() {
    let (manager, _) = make_manager().await;

    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player p1 failed");
    manager
        .set_player("p2", &make_player("p2"))
        .await
        .expect("set_player p2 failed");
    manager
        .set_player("p3", &make_player("p3"))
        .await
        .expect("set_player p3 failed");

    let all = manager
        .get_all_players()
        .await
        .expect("get_all_players failed");

    assert_eq!(all.len(), 3);
    assert!(all.contains_key("p1"));
    assert!(all.contains_key("p2"));
    assert!(all.contains_key("p3"));

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 6. set_players_bulk + get_all_players consistency
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_players_bulk_and_get_all() {
    let (manager, _) = make_manager().await;

    let mut players = HashMap::new();
    for i in 0..5u32 {
        let id = format!("bulk_p{i}");
        players.insert(id.clone(), make_player(&id));
    }

    manager
        .set_players_bulk(&players)
        .await
        .expect("set_players_bulk failed");

    let retrieved = manager
        .get_all_players()
        .await
        .expect("get_all_players failed");

    assert_eq!(retrieved.len(), 5);
    for key in players.keys() {
        assert!(retrieved.contains_key(key), "missing player {key}");
    }

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 7. set_region + get_region round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_and_get_region() {
    let (manager, _) = make_manager().await;

    let region = make_region("Berlin");
    manager
        .set_region("r1", &region)
        .await
        .expect("set_region failed");

    let retrieved = manager
        .get_region("r1")
        .await
        .expect("get_region failed")
        .expect("region should exist");

    assert_eq!(retrieved.name, "Berlin");
    assert_eq!(retrieved.unit_count, 5);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 8. get_all_regions with multiple regions
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_regions_multiple() {
    let (manager, _) = make_manager().await;

    for i in 0..4u32 {
        let id = format!("r{i}");
        let name = format!("Region{i}");
        manager
            .set_region(&id, &make_region(&name))
            .await
            .expect("set_region failed");
    }

    let all = manager
        .get_all_regions()
        .await
        .expect("get_all_regions failed");

    assert_eq!(all.len(), 4);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 9. set_regions_bulk + get_all_regions consistency
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_regions_bulk_and_get_all() {
    let (manager, _) = make_manager().await;

    let mut regions = HashMap::new();
    for i in 0..6u32 {
        let id = format!("bulk_r{i}");
        regions.insert(id.clone(), make_region(&format!("BulkRegion{i}")));
    }

    manager
        .set_regions_bulk(&regions)
        .await
        .expect("set_regions_bulk failed");

    let retrieved = manager
        .get_all_regions()
        .await
        .expect("get_all_regions failed");

    assert_eq!(retrieved.len(), 6);
    for key in regions.keys() {
        assert!(retrieved.contains_key(key), "missing region {key}");
    }

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 10. push_action + verify action stored
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_push_action_stores() {
    let (manager, _) = make_manager().await;

    // Seed meta so get_tick_data can increment tick.
    manager.init_meta(1000, 2).await.expect("init_meta failed");

    let action = make_action("player1", "attack");
    manager
        .push_action(&action)
        .await
        .expect("push_action failed");

    // get_tick_data pops and returns actions then deletes the list.
    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    assert_eq!(tick_data.actions.len(), 1);
    assert_eq!(tick_data.actions[0].action_type, "attack");
    assert_eq!(
        tick_data.actions[0].player_id.as_deref(),
        Some("player1")
    );

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 11. get_tick_data with full state (meta, players, regions, action)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_tick_data_full() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Paris"))
        .await
        .expect("set_region failed");
    manager
        .push_action(&make_action("p1", "move"))
        .await
        .expect("push_action failed");

    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    // Tick is incremented atomically from 0 → 1.
    assert_eq!(tick_data.tick, 1);
    assert!(tick_data.players.contains_key("p1"));
    assert!(tick_data.regions.contains_key("r1"));
    assert_eq!(tick_data.actions.len(), 1);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 12. set_tick_result + verify written
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_tick_result_persists() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");

    let mut players = HashMap::new();
    let mut p = make_player("p1");
    p.energy = 200;
    players.insert("p1".to_string(), p);

    let mut regions = HashMap::new();
    let mut r = make_region("London");
    r.unit_count = 42;
    regions.insert("r1".to_string(), r);

    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[],
            &[],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let retrieved_player = manager
        .get_player("p1")
        .await
        .expect("get_player failed")
        .expect("player should exist");
    assert_eq!(retrieved_player.energy, 200);

    let retrieved_region = manager
        .get_region("r1")
        .await
        .expect("get_region failed")
        .expect("region should exist");
    assert_eq!(retrieved_region.unit_count, 42);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 13. get_full_state — complete round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_round_trip() {
    let (manager, _) = make_manager().await;

    manager.init_meta(500, 3).await.expect("init_meta failed");
    manager
        .set_meta_field("status", "active")
        .await
        .expect("set_meta_field failed");
    manager
        .set_player("user_a", &make_player("user_a"))
        .await
        .expect("set_player failed");
    manager
        .set_region("region_x", &make_region("Tokyo"))
        .await
        .expect("set_region failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert_eq!(
        state.meta.get("status").map(String::as_str),
        Some("active")
    );
    assert!(state.players.contains_key("user_a"));
    assert!(state.regions.contains_key("region_x"));
    assert_eq!(state.regions["region_x"].name, "Tokyo");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 14. validate_state on valid state → true
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_validate_state_valid() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Rome"))
        .await
        .expect("set_region failed");

    let valid = manager
        .validate_state()
        .await
        .expect("validate_state failed");
    assert!(valid, "expected valid state to return true");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 15. validate_state on empty state → false
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_validate_state_empty() {
    let (manager, _) = make_manager().await;

    // No data written — meta hash will be empty.
    let valid = manager
        .validate_state()
        .await
        .expect("validate_state failed");
    assert!(!valid, "expected empty state to return false");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 16. restore_full_state + get_full_state round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_restore_full_state_round_trip() {
    use maplord_state::FullGameState;

    let (manager, _) = make_manager().await;

    let mut meta = HashMap::new();
    meta.insert("status".to_string(), "active".to_string());
    meta.insert("current_tick".to_string(), "5".to_string());

    let mut players = HashMap::new();
    players.insert("p1".to_string(), make_player("p1"));

    let mut regions = HashMap::new();
    regions.insert("r1".to_string(), make_region("Madrid"));

    let original = FullGameState {
        meta,
        players,
        regions,
        buildings_queue: vec![],
        unit_queue: vec![],
        transit_queue: vec![],
        air_transit_queue: vec![],
        active_effects: vec![],
        diplomacy: DiplomacyState::default(),
    };

    manager
        .restore_full_state(&original)
        .await
        .expect("restore_full_state failed");

    let restored = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert_eq!(
        restored.meta.get("status").map(String::as_str),
        Some("active")
    );
    assert_eq!(
        restored.meta.get("current_tick").map(String::as_str),
        Some("5")
    );
    assert!(restored.players.contains_key("p1"));
    assert!(restored.regions.contains_key("r1"));
    assert_eq!(restored.regions["r1"].name, "Madrid");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 17. cleanup removes all keys
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_cleanup_removes_keys() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Athens"))
        .await
        .expect("set_region failed");

    // Confirm data is present before cleanup.
    let pre_meta = manager.get_meta().await.expect("get_meta failed");
    assert!(!pre_meta.is_empty());

    manager.cleanup().await.expect("cleanup failed");

    // After cleanup all hashes should be empty.
    let post_meta = manager.get_meta().await.expect("get_meta failed");
    assert!(post_meta.is_empty(), "meta should be empty after cleanup");

    let post_players = manager
        .get_all_players()
        .await
        .expect("get_all_players failed");
    assert!(
        post_players.is_empty(),
        "players should be empty after cleanup"
    );

    let post_regions = manager
        .get_all_regions()
        .await
        .expect("get_all_regions failed");
    assert!(
        post_regions.is_empty(),
        "regions should be empty after cleanup"
    );
}

// ---------------------------------------------------------------------------
// 18. try_lock + release_lock
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_try_lock_and_release() {
    let (manager, _) = make_manager().await;

    let acquired = manager
        .try_lock("test_lock", 30)
        .await
        .expect("try_lock failed");
    assert!(acquired, "first try_lock should succeed");

    manager
        .release_lock("test_lock")
        .await
        .expect("release_lock failed");

    // After releasing, we should be able to acquire again.
    let reacquired = manager
        .try_lock("test_lock", 30)
        .await
        .expect("second try_lock failed");
    assert!(reacquired, "try_lock after release should succeed");

    manager
        .release_lock("test_lock")
        .await
        .expect("final release_lock failed");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 19. try_lock when already locked → false
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_try_lock_already_locked() {
    let (manager, _) = make_manager().await;

    let first = manager
        .try_lock("contended_lock", 30)
        .await
        .expect("first try_lock failed");
    assert!(first);

    let second = manager
        .try_lock("contended_lock", 30)
        .await
        .expect("second try_lock failed");
    assert!(
        !second,
        "try_lock on an already-locked key should return false"
    );

    manager
        .release_lock("contended_lock")
        .await
        .expect("release_lock failed");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 20. incr_connection + decr_connection tracking
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_incr_decr_connection() {
    let (manager, _) = make_manager().await;

    let after_first = manager
        .incr_connection("user42")
        .await
        .expect("incr_connection failed");
    assert_eq!(after_first, 1);

    let after_second = manager
        .incr_connection("user42")
        .await
        .expect("second incr_connection failed");
    assert_eq!(after_second, 2);

    let after_decr = manager
        .decr_connection("user42")
        .await
        .expect("decr_connection failed");
    assert_eq!(after_decr, 1);

    // Decrement to zero — the key should be cleaned up by the implementation.
    let after_zero = manager
        .decr_connection("user42")
        .await
        .expect("final decr_connection failed");
    assert_eq!(after_zero, 0);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 21. redis() getter returns a usable ConnectionManager clone
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_redis_getter_returns_usable_conn() {
    let (manager, _) = make_manager().await;

    // Obtain a clone of the ConnectionManager via the public getter and
    // exercise it independently — PING should succeed.
    let mut conn = manager.redis();
    let pong: String = redis::cmd("PING")
        .query_async(&mut conn)
        .await
        .expect("PING via redis() getter failed");
    assert_eq!(pong, "PONG");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 22. get_tick_data with buildings_queue populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_tick_data_with_buildings_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Warsaw"))
        .await
        .expect("set_region failed");

    // Pre-populate the buildings_queue list directly via set_tick_result so
    // the data is in the canonical msgpack format that get_tick_data reads.
    let building = BuildingQueueItem {
        region_id: "r1".to_string(),
        building_type: "barracks".to_string(),
        player_id: "p1".to_string(),
        ticks_remaining: 3,
        total_ticks: 5,
        is_upgrade: false,
        target_level: 0,
    };

    let players: HashMap<String, Player> = HashMap::new();
    let regions: HashMap<String, Region> = HashMap::new();
    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[building.clone()],
            &[],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    assert_eq!(tick_data.buildings_queue.len(), 1);
    assert_eq!(tick_data.buildings_queue[0].region_id, "r1");
    assert_eq!(tick_data.buildings_queue[0].building_type, "barracks");
    assert_eq!(tick_data.buildings_queue[0].ticks_remaining, 3);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 23. get_tick_data with unit_queue populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_tick_data_with_unit_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Krakow"))
        .await
        .expect("set_region failed");

    let unit_item = UnitQueueItem {
        region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "infantry".to_string(),
        quantity: Some(10),
        manpower_cost: Some(5),
        ticks_remaining: 2,
        total_ticks: 4,
    };

    let players: HashMap<String, Player> = HashMap::new();
    let regions: HashMap<String, Region> = HashMap::new();
    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[],
            &[unit_item.clone()],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    assert_eq!(tick_data.unit_queue.len(), 1);
    assert_eq!(tick_data.unit_queue[0].unit_type, "infantry");
    assert_eq!(tick_data.unit_queue[0].quantity, Some(10));

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 24. get_tick_data with transit_queue populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_tick_data_with_transit_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Gdansk"))
        .await
        .expect("set_region failed");

    let transit = TransitQueueItem {
        action_type: "move".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r2".to_string(),
        player_id: "p1".to_string(),
        unit_type: "infantry".to_string(),
        units: 50,
        ticks_remaining: 1,
        travel_ticks: 3,
    };

    let players: HashMap<String, Player> = HashMap::new();
    let regions: HashMap<String, Region> = HashMap::new();
    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[],
            &[],
            &[transit.clone()],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    assert_eq!(tick_data.transit_queue.len(), 1);
    assert_eq!(tick_data.transit_queue[0].source_region_id, "r1");
    assert_eq!(tick_data.transit_queue[0].target_region_id, "r2");
    assert_eq!(tick_data.transit_queue[0].units, 50);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 25. get_tick_data with air_transit_queue populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_tick_data_with_air_transit_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Poznan"))
        .await
        .expect("set_region failed");

    let air_item = AirTransitItem {
        id: "air-001".to_string(),
        mission_type: "bomb_run".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r3".to_string(),
        player_id: "p1".to_string(),
        unit_type: "bomber".to_string(),
        units: 3,
        escort_fighters: 2,
        progress: 0.25,
        speed_per_tick: 0.1,
        total_distance: 4,
        interceptors: vec![],
        flight_path: vec!["r1".to_string(), "r2".to_string(), "r3".to_string()],
        last_bombed_hop: 0,
    };

    let players: HashMap<String, Player> = HashMap::new();
    let regions: HashMap<String, Region> = HashMap::new();
    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[],
            &[],
            &[],
            &[air_item.clone()],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    assert_eq!(tick_data.air_transit_queue.len(), 1);
    assert_eq!(tick_data.air_transit_queue[0].id, "air-001");
    assert_eq!(tick_data.air_transit_queue[0].mission_type, "bomb_run");
    assert_eq!(tick_data.air_transit_queue[0].units, 3);
    assert_eq!(tick_data.air_transit_queue[0].escort_fighters, 2);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 26. get_tick_data with active_effects populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_tick_data_with_active_effects() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Lodz"))
        .await
        .expect("set_region failed");

    let effect = ActiveEffect {
        effect_type: "fortify".to_string(),
        source_player_id: "p1".to_string(),
        target_region_id: "r1".to_string(),
        affected_region_ids: vec!["r1".to_string()],
        ticks_remaining: 5,
        total_ticks: 10,
        params: serde_json::json!({"bonus": 0.2}),
    };

    let players: HashMap<String, Player> = HashMap::new();
    let regions: HashMap<String, Region> = HashMap::new();
    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[],
            &[],
            &[],
            &[],
            &[effect.clone()],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let tick_data = manager
        .get_tick_data()
        .await
        .expect("get_tick_data failed");

    assert_eq!(tick_data.active_effects.len(), 1);
    assert_eq!(tick_data.active_effects[0].effect_type, "fortify");
    assert_eq!(tick_data.active_effects[0].ticks_remaining, 5);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 27. set_tick_result with all queue types populated — RPUSH branches
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_set_tick_result_all_queues_populated() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");

    let mut players = HashMap::new();
    let mut p = make_player("p1");
    p.energy = 80;
    players.insert("p1".to_string(), p);

    let mut regions = HashMap::new();
    let mut r = make_region("Wroclaw");
    r.unit_count = 15;
    regions.insert("r1".to_string(), r);

    let building = BuildingQueueItem {
        region_id: "r1".to_string(),
        building_type: "fortress".to_string(),
        player_id: "p1".to_string(),
        ticks_remaining: 4,
        total_ticks: 8,
        is_upgrade: true,
        target_level: 2,
    };

    let unit_item = UnitQueueItem {
        region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "tank".to_string(),
        quantity: Some(5),
        manpower_cost: Some(20),
        ticks_remaining: 3,
        total_ticks: 6,
    };

    let transit = TransitQueueItem {
        action_type: "attack".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r2".to_string(),
        player_id: "p1".to_string(),
        unit_type: "infantry".to_string(),
        units: 25,
        ticks_remaining: 2,
        travel_ticks: 4,
    };

    let air_item = AirTransitItem {
        id: "air-002".to_string(),
        mission_type: "fighter_attack".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r5".to_string(),
        player_id: "p1".to_string(),
        unit_type: "fighter".to_string(),
        units: 6,
        escort_fighters: 0,
        progress: 0.5,
        speed_per_tick: 0.2,
        total_distance: 2,
        interceptors: vec![],
        flight_path: vec!["r1".to_string(), "r5".to_string()],
        last_bombed_hop: 0,
    };

    let effect = ActiveEffect {
        effect_type: "shield".to_string(),
        source_player_id: "p1".to_string(),
        target_region_id: "r1".to_string(),
        affected_region_ids: vec!["r1".to_string()],
        ticks_remaining: 3,
        total_ticks: 3,
        params: serde_json::json!(null),
    };

    let diplomacy = DiplomacyState::default();

    manager
        .set_tick_result(
            &players,
            &regions,
            &[building],
            &[unit_item],
            &[transit],
            &[air_item],
            &[effect],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result with all queues failed");

    // Verify all queues were written correctly.
    let buildings = manager
        .get_all_buildings()
        .await
        .expect("get_all_buildings failed");
    assert_eq!(buildings.len(), 1);
    assert_eq!(buildings[0].building_type, "fortress");
    assert!(buildings[0].is_upgrade);

    let units = manager
        .get_all_unit_queue()
        .await
        .expect("get_all_unit_queue failed");
    assert_eq!(units.len(), 1);
    assert_eq!(units[0].unit_type, "tank");

    let transits = manager
        .get_all_transit_queue()
        .await
        .expect("get_all_transit_queue failed");
    assert_eq!(transits.len(), 1);
    assert_eq!(transits[0].units, 25);

    let air = manager
        .get_all_air_transit_queue()
        .await
        .expect("get_all_air_transit_queue failed");
    assert_eq!(air.len(), 1);
    assert_eq!(air[0].id, "air-002");

    let effects = manager
        .get_all_active_effects()
        .await
        .expect("get_all_active_effects failed");
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].effect_type, "shield");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 28. get_full_state with all queues populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_all_queues_populated() {
    let (manager, _) = make_manager().await;

    manager.init_meta(500, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Berlin"))
        .await
        .expect("set_region failed");

    let players: HashMap<String, Player> = HashMap::new();
    let regions: HashMap<String, Region> = HashMap::new();
    let diplomacy = DiplomacyState::default();

    let building = BuildingQueueItem {
        region_id: "r1".to_string(),
        building_type: "factory".to_string(),
        player_id: "p1".to_string(),
        ticks_remaining: 2,
        total_ticks: 5,
        is_upgrade: false,
        target_level: 0,
    };

    let unit_item = UnitQueueItem {
        region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "artillery".to_string(),
        quantity: Some(2),
        manpower_cost: Some(30),
        ticks_remaining: 1,
        total_ticks: 3,
    };

    let transit = TransitQueueItem {
        action_type: "reinforce".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r2".to_string(),
        player_id: "p1".to_string(),
        unit_type: "infantry".to_string(),
        units: 10,
        ticks_remaining: 1,
        travel_ticks: 2,
    };

    let air_item = AirTransitItem {
        id: "air-003".to_string(),
        mission_type: "escort_return".to_string(),
        source_region_id: "r2".to_string(),
        target_region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "fighter".to_string(),
        units: 4,
        escort_fighters: 0,
        progress: 0.75,
        speed_per_tick: 0.25,
        total_distance: 1,
        interceptors: vec![],
        flight_path: vec!["r2".to_string(), "r1".to_string()],
        last_bombed_hop: 0,
    };

    let effect = ActiveEffect {
        effect_type: "nuke_fallout".to_string(),
        source_player_id: "p1".to_string(),
        target_region_id: "r2".to_string(),
        affected_region_ids: vec!["r2".to_string()],
        ticks_remaining: 2,
        total_ticks: 5,
        params: serde_json::json!({"radiation": 0.8}),
    };

    manager
        .set_tick_result(
            &players,
            &regions,
            &[building],
            &[unit_item],
            &[transit],
            &[air_item],
            &[effect],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert_eq!(state.buildings_queue.len(), 1);
    assert_eq!(state.buildings_queue[0].building_type, "factory");

    assert_eq!(state.unit_queue.len(), 1);
    assert_eq!(state.unit_queue[0].unit_type, "artillery");

    assert_eq!(state.transit_queue.len(), 1);
    assert_eq!(state.transit_queue[0].action_type, "reinforce");

    assert_eq!(state.air_transit_queue.len(), 1);
    assert_eq!(state.air_transit_queue[0].id, "air-003");

    assert_eq!(state.active_effects.len(), 1);
    assert_eq!(state.active_effects[0].effect_type, "nuke_fallout");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 29. restore_full_state with all queue types populated
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_restore_full_state_all_queues() {
    let (manager, _) = make_manager().await;

    let mut meta = HashMap::new();
    meta.insert("status".to_string(), "active".to_string());
    meta.insert("current_tick".to_string(), "7".to_string());

    let mut players = HashMap::new();
    players.insert("p1".to_string(), make_player("p1"));

    let mut regions = HashMap::new();
    regions.insert("r1".to_string(), make_region("Vienna"));

    let building = BuildingQueueItem {
        region_id: "r1".to_string(),
        building_type: "watchtower".to_string(),
        player_id: "p1".to_string(),
        ticks_remaining: 1,
        total_ticks: 3,
        is_upgrade: false,
        target_level: 0,
    };

    let unit_item = UnitQueueItem {
        region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "cavalry".to_string(),
        quantity: Some(3),
        manpower_cost: Some(15),
        ticks_remaining: 2,
        total_ticks: 5,
    };

    let transit = TransitQueueItem {
        action_type: "move".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r3".to_string(),
        player_id: "p1".to_string(),
        unit_type: "cavalry".to_string(),
        units: 12,
        ticks_remaining: 1,
        travel_ticks: 2,
    };

    let air_item = AirTransitItem {
        id: "air-restore-01".to_string(),
        mission_type: "bomb_run".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r4".to_string(),
        player_id: "p1".to_string(),
        unit_type: "bomber".to_string(),
        units: 2,
        escort_fighters: 1,
        progress: 0.1,
        speed_per_tick: 0.1,
        total_distance: 3,
        interceptors: vec![],
        flight_path: vec!["r1".to_string(), "r2".to_string(), "r4".to_string()],
        last_bombed_hop: 0,
    };

    let effect = ActiveEffect {
        effect_type: "fortify".to_string(),
        source_player_id: "p1".to_string(),
        target_region_id: "r1".to_string(),
        affected_region_ids: vec!["r1".to_string()],
        ticks_remaining: 4,
        total_ticks: 6,
        params: serde_json::json!(null),
    };

    let original = FullGameState {
        meta,
        players,
        regions,
        buildings_queue: vec![building],
        unit_queue: vec![unit_item],
        transit_queue: vec![transit],
        air_transit_queue: vec![air_item],
        active_effects: vec![effect],
        diplomacy: DiplomacyState::default(),
    };

    manager
        .restore_full_state(&original)
        .await
        .expect("restore_full_state failed");

    let restored = manager
        .get_full_state()
        .await
        .expect("get_full_state after restore failed");

    assert_eq!(
        restored.meta.get("current_tick").map(String::as_str),
        Some("7")
    );
    assert!(restored.players.contains_key("p1"));
    assert!(restored.regions.contains_key("r1"));
    assert_eq!(restored.regions["r1"].name, "Vienna");

    assert_eq!(restored.buildings_queue.len(), 1);
    assert_eq!(restored.buildings_queue[0].building_type, "watchtower");

    assert_eq!(restored.unit_queue.len(), 1);
    assert_eq!(restored.unit_queue[0].unit_type, "cavalry");

    assert_eq!(restored.transit_queue.len(), 1);
    assert_eq!(restored.transit_queue[0].units, 12);

    assert_eq!(restored.air_transit_queue.len(), 1);
    assert_eq!(restored.air_transit_queue[0].id, "air-restore-01");

    assert_eq!(restored.active_effects.len(), 1);
    assert_eq!(restored.active_effects[0].effect_type, "fortify");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 30. get_full_state with only buildings_queue populated
//     Covers lines 402-406 (buildings_queue deser iter closure).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_only_buildings_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Oslo"))
        .await
        .expect("set_region failed");

    let building = BuildingQueueItem {
        region_id: "r1".to_string(),
        building_type: "barracks".to_string(),
        player_id: "p1".to_string(),
        ticks_remaining: 2,
        total_ticks: 4,
        is_upgrade: false,
        target_level: 0,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[building],
            &[],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert_eq!(state.buildings_queue.len(), 1);
    assert_eq!(state.buildings_queue[0].building_type, "barracks");
    assert!(state.unit_queue.is_empty());
    assert!(state.transit_queue.is_empty());
    assert!(state.air_transit_queue.is_empty());
    assert!(state.active_effects.is_empty());

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 31. get_full_state with only unit_queue populated
//     Covers lines 407-411 (unit_queue deser iter closure).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_only_unit_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Stockholm"))
        .await
        .expect("set_region failed");

    let unit_item = UnitQueueItem {
        region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "tank".to_string(),
        quantity: Some(4),
        manpower_cost: Some(10),
        ticks_remaining: 1,
        total_ticks: 3,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[unit_item],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert!(state.buildings_queue.is_empty());
    assert_eq!(state.unit_queue.len(), 1);
    assert_eq!(state.unit_queue[0].unit_type, "tank");
    assert_eq!(state.unit_queue[0].quantity, Some(4));
    assert!(state.transit_queue.is_empty());
    assert!(state.air_transit_queue.is_empty());
    assert!(state.active_effects.is_empty());

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 32. get_full_state with only transit_queue populated
//     Covers lines 412-416 (transit_queue deser iter closure).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_only_transit_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Helsinki"))
        .await
        .expect("set_region failed");

    let transit = TransitQueueItem {
        action_type: "move".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r2".to_string(),
        player_id: "p1".to_string(),
        unit_type: "infantry".to_string(),
        units: 20,
        ticks_remaining: 2,
        travel_ticks: 3,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[],
            &[transit],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert!(state.buildings_queue.is_empty());
    assert!(state.unit_queue.is_empty());
    assert_eq!(state.transit_queue.len(), 1);
    assert_eq!(state.transit_queue[0].source_region_id, "r1");
    assert_eq!(state.transit_queue[0].units, 20);
    assert!(state.air_transit_queue.is_empty());
    assert!(state.active_effects.is_empty());

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 33. get_full_state with only air_transit_queue populated
//     Covers lines 417-421 (air_transit_queue deser iter closure).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_only_air_transit_queue() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Copenhagen"))
        .await
        .expect("set_region failed");

    let air_item = AirTransitItem {
        id: "air-solo".to_string(),
        mission_type: "bomb_run".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r2".to_string(),
        player_id: "p1".to_string(),
        unit_type: "bomber".to_string(),
        units: 2,
        escort_fighters: 0,
        progress: 0.0,
        speed_per_tick: 0.5,
        total_distance: 2,
        interceptors: vec![],
        flight_path: vec!["r1".to_string(), "r2".to_string()],
        last_bombed_hop: 0,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[],
            &[],
            &[air_item],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert!(state.buildings_queue.is_empty());
    assert!(state.unit_queue.is_empty());
    assert!(state.transit_queue.is_empty());
    assert_eq!(state.air_transit_queue.len(), 1);
    assert_eq!(state.air_transit_queue[0].id, "air-solo");
    assert_eq!(state.air_transit_queue[0].mission_type, "bomb_run");
    assert!(state.active_effects.is_empty());

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 34. get_full_state with only active_effects populated
//     Covers lines 422-426 (active_effects deser iter closure).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_full_state_only_active_effects() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Reykjavik"))
        .await
        .expect("set_region failed");

    let effect = ActiveEffect {
        effect_type: "fortify".to_string(),
        source_player_id: "p1".to_string(),
        target_region_id: "r1".to_string(),
        affected_region_ids: vec!["r1".to_string()],
        ticks_remaining: 3,
        total_ticks: 6,
        params: serde_json::json!({"bonus": 0.3}),
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[],
            &[],
            &[],
            &[effect],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let state = manager
        .get_full_state()
        .await
        .expect("get_full_state failed");

    assert!(state.buildings_queue.is_empty());
    assert!(state.unit_queue.is_empty());
    assert!(state.transit_queue.is_empty());
    assert!(state.air_transit_queue.is_empty());
    assert_eq!(state.active_effects.len(), 1);
    assert_eq!(state.active_effects[0].effect_type, "fortify");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 35. validate_state — meta present but current_tick is not parseable
//     Covers line 457 (tick_valid false branch → return Ok(false)).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_validate_state_invalid_tick_format() {
    let (manager, _) = make_manager().await;

    // Write a meta hash with a non-numeric current_tick value so that the
    // `v.parse::<i64>().ok()` call inside validate_state yields None.
    manager.init_meta(1000, 2).await.expect("init_meta failed");
    manager
        .set_meta_field("current_tick", "not_a_number")
        .await
        .expect("set_meta_field failed");

    // Also add a player and region so only the tick parse fails.
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");
    manager
        .set_region("r1", &make_region("Dublin"))
        .await
        .expect("set_region failed");

    let valid = manager
        .validate_state()
        .await
        .expect("validate_state failed");
    assert!(
        !valid,
        "unparseable current_tick should cause validate_state to return false"
    );

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 36. validate_state — meta + valid tick but no players at all
//     Covers line 460 (results.1 == 0 branch → return Ok(false)).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_validate_state_no_players() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    // Deliberately write a region but no player.
    manager
        .set_region("r1", &make_region("Lisbon"))
        .await
        .expect("set_region failed");

    let valid = manager
        .validate_state()
        .await
        .expect("validate_state failed");
    assert!(
        !valid,
        "zero players should cause validate_state to return false"
    );

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 37. validate_state — meta + valid tick + players but no regions
//     Covers line 460 (results.2 == 0 branch → return Ok(false)).
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_validate_state_no_regions() {
    let (manager, _) = make_manager().await;

    manager.init_meta(1000, 2).await.expect("init_meta failed");
    // Deliberately write a player but no region.
    manager
        .set_player("p1", &make_player("p1"))
        .await
        .expect("set_player failed");

    let valid = manager
        .validate_state()
        .await
        .expect("validate_state failed");
    assert!(
        !valid,
        "zero regions should cause validate_state to return false"
    );

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 38. get_all_players — deser closure executed (line 120-121)
//     Explicitly verifies that the per-entry deserialization runs correctly
//     by writing three players and reading them all back.
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_players_deser_closure() {
    let (manager, _) = make_manager().await;

    for i in 0..3u32 {
        let id = format!("deser_p{i}");
        manager
            .set_player(&id, &make_player(&id))
            .await
            .expect("set_player failed");
    }

    let all = manager
        .get_all_players()
        .await
        .expect("get_all_players failed");

    // Three entries → the closure on line 120-121 ran three times.
    assert_eq!(all.len(), 3);
    for i in 0..3u32 {
        let id = format!("deser_p{i}");
        assert!(all.contains_key(&id), "missing key {id}");
        assert_eq!(all[&id].user_id, id);
    }

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 39. get_all_regions — deser closure executed (line 157-158)
//     Mirrors test 38 for regions.
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_regions_deser_closure() {
    let (manager, _) = make_manager().await;

    for i in 0..3u32 {
        let id = format!("deser_r{i}");
        manager
            .set_region(&id, &make_region(&format!("DeserCity{i}")))
            .await
            .expect("set_region failed");
    }

    let all = manager
        .get_all_regions()
        .await
        .expect("get_all_regions failed");

    assert_eq!(all.len(), 3);
    for i in 0..3u32 {
        let id = format!("deser_r{i}");
        assert!(all.contains_key(&id), "missing key {id}");
        assert_eq!(all[&id].name, format!("DeserCity{i}"));
    }

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 40. get_all_buildings — deser closure on populated list (line 614-615)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_buildings_deser_closure() {
    let (manager, _) = make_manager().await;

    let building = BuildingQueueItem {
        region_id: "r1".to_string(),
        building_type: "lighthouse".to_string(),
        player_id: "p1".to_string(),
        ticks_remaining: 1,
        total_ticks: 2,
        is_upgrade: false,
        target_level: 0,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[building],
            &[],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let buildings = manager
        .get_all_buildings()
        .await
        .expect("get_all_buildings failed");

    // Non-empty list → deser closure on line 614 executed.
    assert_eq!(buildings.len(), 1);
    assert_eq!(buildings[0].building_type, "lighthouse");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 41. get_all_unit_queue — deser closure on populated list (line 623-624)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_unit_queue_deser_closure() {
    let (manager, _) = make_manager().await;

    let unit_item = UnitQueueItem {
        region_id: "r1".to_string(),
        player_id: "p1".to_string(),
        unit_type: "sniper".to_string(),
        quantity: Some(1),
        manpower_cost: Some(5),
        ticks_remaining: 1,
        total_ticks: 2,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[unit_item],
            &[],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let units = manager
        .get_all_unit_queue()
        .await
        .expect("get_all_unit_queue failed");

    assert_eq!(units.len(), 1);
    assert_eq!(units[0].unit_type, "sniper");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 42. get_all_transit_queue — deser closure on populated list (line 632-633)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_transit_queue_deser_closure() {
    let (manager, _) = make_manager().await;

    let transit = TransitQueueItem {
        action_type: "reinforce".to_string(),
        source_region_id: "rA".to_string(),
        target_region_id: "rB".to_string(),
        player_id: "p1".to_string(),
        unit_type: "artillery".to_string(),
        units: 8,
        ticks_remaining: 1,
        travel_ticks: 2,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[],
            &[transit],
            &[],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let transits = manager
        .get_all_transit_queue()
        .await
        .expect("get_all_transit_queue failed");

    assert_eq!(transits.len(), 1);
    assert_eq!(transits[0].source_region_id, "rA");
    assert_eq!(transits[0].units, 8);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 43. get_all_air_transit_queue — deser closure on populated list (line 641-642)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_air_transit_queue_deser_closure() {
    let (manager, _) = make_manager().await;

    let air_item = AirTransitItem {
        id: "air-deser-01".to_string(),
        mission_type: "fighter_patrol".to_string(),
        source_region_id: "r1".to_string(),
        target_region_id: "r2".to_string(),
        player_id: "p1".to_string(),
        unit_type: "fighter".to_string(),
        units: 3,
        escort_fighters: 0,
        progress: 0.2,
        speed_per_tick: 0.4,
        total_distance: 1,
        interceptors: vec![],
        flight_path: vec!["r1".to_string(), "r2".to_string()],
        last_bombed_hop: 0,
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[],
            &[],
            &[air_item],
            &[],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let air = manager
        .get_all_air_transit_queue()
        .await
        .expect("get_all_air_transit_queue failed");

    assert_eq!(air.len(), 1);
    assert_eq!(air[0].id, "air-deser-01");
    assert_eq!(air[0].mission_type, "fighter_patrol");

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 44. get_all_active_effects — deser closure on populated list (line 650-651)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_all_active_effects_deser_closure() {
    let (manager, _) = make_manager().await;

    let effect = ActiveEffect {
        effect_type: "shield".to_string(),
        source_player_id: "p1".to_string(),
        target_region_id: "r1".to_string(),
        affected_region_ids: vec!["r1".to_string()],
        ticks_remaining: 4,
        total_ticks: 8,
        params: serde_json::json!(null),
    };

    let diplomacy = DiplomacyState::default();
    manager
        .set_tick_result(
            &HashMap::new(),
            &HashMap::new(),
            &[],
            &[],
            &[],
            &[],
            &[effect],
            &diplomacy,
            None,
        )
        .await
        .expect("set_tick_result failed");

    let effects = manager
        .get_all_active_effects()
        .await
        .expect("get_all_active_effects failed");

    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].effect_type, "shield");
    assert_eq!(effects[0].ticks_remaining, 4);

    manager.cleanup().await.expect("cleanup failed");
}

// ---------------------------------------------------------------------------
// 45. incr_connection / decr_connection — verify key format
//     Covers lines 586-592 (incr key format) and 597-604 (decr key format).
//     Tests multiple players to ensure key namespacing is correct.
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_connection_tracking_key_namespacing() {
    let (manager, _) = make_manager().await;

    // Increment two distinct players — their counters must be independent.
    let c1a = manager
        .incr_connection("user-alpha")
        .await
        .expect("incr_connection user-alpha failed");
    let c2a = manager
        .incr_connection("user-beta")
        .await
        .expect("incr_connection user-beta failed");
    assert_eq!(c1a, 1, "first incr for user-alpha should be 1");
    assert_eq!(c2a, 1, "first incr for user-beta should be 1 (independent key)");

    let c1b = manager
        .incr_connection("user-alpha")
        .await
        .expect("second incr_connection user-alpha failed");
    assert_eq!(c1b, 2, "second incr for user-alpha should be 2");

    // Beta counter is still 1 — not affected by alpha's second increment.
    let c2_check = manager
        .incr_connection("user-beta")
        .await
        .expect("second incr_connection user-beta failed");
    assert_eq!(c2_check, 2);

    // Decrement to 1 → key remains.
    let d1 = manager
        .decr_connection("user-alpha")
        .await
        .expect("decr_connection user-alpha failed");
    assert_eq!(d1, 1);

    // Decrement alpha to 0 → key is deleted; next incr resets to 1.
    let d2 = manager
        .decr_connection("user-alpha")
        .await
        .expect("second decr_connection user-alpha failed");
    assert_eq!(d2, 0);

    let c_reset = manager
        .incr_connection("user-alpha")
        .await
        .expect("reset incr_connection user-alpha failed");
    assert_eq!(c_reset, 1, "after deletion, incr should start at 1 again");

    // Decrement beta twice to clean up.
    manager
        .decr_connection("user-beta")
        .await
        .expect("cleanup decr user-beta 1 failed");
    manager
        .decr_connection("user-beta")
        .await
        .expect("cleanup decr user-beta 2 failed");
    manager
        .decr_connection("user-alpha")
        .await
        .expect("cleanup decr user-alpha failed");

    manager.cleanup().await.expect("cleanup failed");
}
