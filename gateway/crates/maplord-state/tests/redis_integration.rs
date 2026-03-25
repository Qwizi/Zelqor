// Redis integration tests for maplord-state.
//
// These tests require a live Redis instance. They are gated with `#[ignore]`
// so the normal `cargo test` run skips them. To run them:
//
//   cargo test -p maplord-state -- --include-ignored
//
// Override the Redis URL via the `REDIS_URL` environment variable.
// The tests use database 15 by default to avoid interfering with other data.

use maplord_engine::{Action, DiplomacyState, Player, Region};
use maplord_state::GameStateManager;
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
