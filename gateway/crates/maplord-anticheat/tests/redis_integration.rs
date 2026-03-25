// Redis integration tests for maplord-anticheat.
//
// These tests require a live Redis instance. They are gated with `#[ignore]`
// so the normal `cargo test` run skips them. To run them:
//
//   cargo test -p maplord-anticheat -- --include-ignored
//
// Override the Redis URL via the `REDIS_URL` environment variable.
// The tests use database 15 by default to avoid interfering with other data.

use maplord_anticheat::{AnticheatEngine, AnticheatVerdict};
use maplord_engine::{Action, Player, Region};
use redis::aio::ConnectionManager;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async fn make_engine() -> (AnticheatEngine, String) {
    let url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379/15".into());
    let match_id = uuid::Uuid::new_v4().to_string();
    let client = redis::Client::open(url).expect("valid Redis URL");
    let conn = ConnectionManager::new(client)
        .await
        .expect("Redis connection failed — is Redis running?");
    let engine = AnticheatEngine::new(match_id.clone(), conn);
    (engine, match_id)
}

fn make_action(player_id: &str, action_type: &str) -> Action {
    Action {
        action_type: action_type.to_string(),
        player_id: Some(player_id.to_string()),
        ..Default::default()
    }
}

fn make_attack_action(player_id: &str, target_region_id: &str) -> Action {
    Action {
        action_type: "attack".to_string(),
        player_id: Some(player_id.to_string()),
        target_region_id: Some(target_region_id.to_string()),
        ..Default::default()
    }
}

fn make_player(user_id: &str, is_bot: bool) -> Player {
    Player {
        user_id: user_id.to_string(),
        is_bot,
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// 1. AnticheatEngine::new connects
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_new_connects() {
    let (engine, _) = make_engine().await;
    // Getting here without panicking means the connection succeeded.
    // Verify by retrieving an empty action log.
    let log = engine.get_action_log().await;
    assert!(log.is_empty(), "fresh engine should have empty action log");
    engine.cleanup().await;
}

// ---------------------------------------------------------------------------
// 2. log_actions stores actions
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_log_actions_stores() {
    let (mut engine, _) = make_engine().await;

    let actions = vec![
        make_action("p1", "move"),
        make_action("p1", "build"),
        make_action("p2", "attack"),
    ];

    engine.log_actions(&actions, 1).await;

    let log = engine.get_action_log().await;
    assert_eq!(log.len(), 3, "expected 3 log entries");

    engine.cleanup().await;
}

// ---------------------------------------------------------------------------
// 3. get_action_log retrieves stored actions
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_get_action_log_retrieves() {
    let (mut engine, _) = make_engine().await;

    let tick1 = vec![make_action("alpha", "move")];
    let tick2 = vec![make_action("beta", "attack"), make_action("beta", "build")];

    engine.log_actions(&tick1, 1).await;
    engine.log_actions(&tick2, 2).await;

    let log = engine.get_action_log().await;
    assert_eq!(log.len(), 3);

    // Entries should be in insertion order (RPUSH + LRANGE).
    assert_eq!(log[0].player_id, "alpha");
    assert_eq!(log[0].action_type, "move");
    assert_eq!(log[0].tick, 1);
    assert_eq!(log[1].player_id, "beta");
    assert_eq!(log[2].player_id, "beta");

    engine.cleanup().await;
}

// ---------------------------------------------------------------------------
// 4. analyze_tick with clean actions → Allow verdict
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_analyze_tick_clean_actions_allow() {
    let (mut engine, _) = make_engine().await;

    let actions = vec![
        make_action("p1", "move"),
        make_action("p1", "build"),
    ];
    let regions: HashMap<String, Region> = HashMap::new();
    let mut players = HashMap::new();
    players.insert("p1".to_string(), make_player("p1", false));
    let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();

    let verdict = engine
        .analyze_tick(&actions, 1, &regions, &players, &neighbor_map)
        .await;

    assert_eq!(
        verdict,
        AnticheatVerdict::Allow,
        "two clean actions should produce Allow verdict"
    );

    engine.cleanup().await;
}

// ---------------------------------------------------------------------------
// 5. analyze_tick with flood actions → non-Allow verdict
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_analyze_tick_flood_non_allow() {
    let (mut engine, _) = make_engine().await;

    let mut players = HashMap::new();
    players.insert("p1".to_string(), make_player("p1", false));
    let regions: HashMap<String, Region> = HashMap::new();
    let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();

    // FLOOD_THRESHOLD is 20 actions/tick and FLOOD_WINDOW is 5 ticks.
    // Send 25 actions per tick for 5 consecutive ticks to trigger the flood detector.
    let mut final_verdict = AnticheatVerdict::Allow;
    for tick in 1..=6i64 {
        let flood_actions: Vec<Action> = (0..25)
            .map(|_| make_action("p1", "move"))
            .collect();
        final_verdict = engine
            .analyze_tick(&flood_actions, tick, &regions, &players, &neighbor_map)
            .await;
    }

    assert_ne!(
        final_verdict,
        AnticheatVerdict::Allow,
        "sustained flood should produce a non-Allow verdict"
    );

    engine.cleanup().await;
}

// ---------------------------------------------------------------------------
// 6. analyze_tick skips bot players (player_id starts with "bot-")
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_analyze_tick_skips_bots() {
    let (mut engine, _) = make_engine().await;

    // Register a player with is_bot=true and the "bot-" prefix.
    let mut players = HashMap::new();
    players.insert("bot-1".to_string(), make_player("bot-1", true));
    let regions: HashMap<String, Region> = HashMap::new();
    let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();

    // Flood the engine with bot actions across many ticks — should never flag the bot.
    let mut all_allow = true;
    for tick in 1..=10i64 {
        let flood: Vec<Action> = (0..50)
            .map(|_| make_action("bot-1", "move"))
            .collect();
        let verdict = engine
            .analyze_tick(&flood, tick, &regions, &players, &neighbor_map)
            .await;
        if verdict != AnticheatVerdict::Allow {
            all_allow = false;
        }
    }

    assert!(all_allow, "bot actions should always yield Allow verdict");

    engine.cleanup().await;
}

// ---------------------------------------------------------------------------
// 7. cleanup removes keys
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_cleanup_removes_keys() {
    let (mut engine, _) = make_engine().await;

    let actions = vec![make_action("p1", "move"), make_action("p2", "build")];
    engine.log_actions(&actions, 1).await;

    // Confirm data exists.
    let pre_log = engine.get_action_log().await;
    assert!(!pre_log.is_empty(), "log should be non-empty before cleanup");

    engine.cleanup().await;

    // After cleanup the log should be empty.
    let post_log = engine.get_action_log().await;
    assert!(
        post_log.is_empty(),
        "action log should be empty after cleanup"
    );
}
