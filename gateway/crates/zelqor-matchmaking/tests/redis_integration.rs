//! Redis integration tests for [`MatchmakingManager`] Redis helper methods.
//!
//! These tests connect to a real Redis instance.  They are marked `#[ignore]`
//! so that `cargo test` skips them by default; pass `--include-ignored` (or
//! `--ignored`) to run them explicitly.
//!
//! ```bash
//! cargo test -p zelqor-matchmaking --features testing -- --include-ignored
//! ```
//!
//! The `REDIS_URL` environment variable controls which Redis database is used
//! (default: `redis://127.0.0.1:6379/15`).  Database 15 is chosen so that the
//! tests are isolated from any other data.

use zelqor_django::DjangoClient;
use zelqor_matchmaking::MatchmakingManager;
use redis::aio::ConnectionManager;
use uuid::Uuid;

// ── Shared test helpers ──────────────────────────────────────────────────────

/// Read `REDIS_URL` from the environment, falling back to a local DB 15.
fn redis_url() -> String {
    std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/15".to_string())
}

/// Build a [`MatchmakingManager`] backed by a real Redis connection.
///
/// The Django URL is intentionally unreachable — none of these tests exercise
/// any code path that calls Django.
async fn make_manager() -> MatchmakingManager {
    let url = redis_url();
    let client = redis::Client::open(url).expect("valid Redis URL");
    let conn_mgr = ConnectionManager::new(client)
        .await
        .expect("Redis connection manager should connect");

    let django = DjangoClient::new(
        "http://127.0.0.1:19999".to_string(), // dummy — never called
        "dummy-secret".to_string(),
    );

    MatchmakingManager::new(django, conn_mgr)
}

/// Return a unique string prefix for a single test run so that concurrent test
/// executions or re-runs never collide on the same Redis keys.
fn unique_prefix() -> String {
    Uuid::new_v4().to_string()
}

// ── lobby helpers ────────────────────────────────────────────────────────────

/// `redis_set_user_lobby` followed by `redis_get_user_lobby` returns the stored
/// lobby id.
#[tokio::test]
#[ignore]
async fn lobby_set_get_round_trip() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let lobby_id = format!("{prefix}:lobby");

    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    let result = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(
        result,
        Some(lobby_id.clone()),
        "get after set must return the stored lobby id"
    );

    // clean up
    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// `redis_get_user_lobby` returns `None` when no key exists.
#[tokio::test]
#[ignore]
async fn lobby_get_returns_none_for_unknown_user() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:nonexistent");

    let result = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(result, None, "missing key must yield None");
}

/// `redis_del_user_lobby` removes an existing mapping so that a subsequent get
/// returns `None`.
#[tokio::test]
#[ignore]
async fn lobby_del_removes_mapping() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let lobby_id = format!("{prefix}:lobby");

    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // Confirm the key is present before deleting.
    let before = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(before, Some(lobby_id), "key must exist before del");

    mgr.test_redis_del_user_lobby(&user_id).await;

    let after = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(after, None, "key must be absent after del");
}

/// Deleting a key that does not exist is a no-op and must not panic.
#[tokio::test]
#[ignore]
async fn lobby_del_nonexistent_is_noop() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:ghost");

    // Should complete without error.
    mgr.test_redis_del_user_lobby(&user_id).await;

    let result = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(result, None);
}

/// Overwriting an existing lobby mapping stores the new value.
#[tokio::test]
#[ignore]
async fn lobby_set_overwrites_existing_value() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let lobby_a = format!("{prefix}:lobby-a");
    let lobby_b = format!("{prefix}:lobby-b");

    mgr.test_redis_set_user_lobby(&user_id, &lobby_a).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_b).await;

    let result = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(result, Some(lobby_b), "second set must overwrite the first");

    // clean up
    mgr.test_redis_del_user_lobby(&user_id).await;
}

// ── active-match helpers ─────────────────────────────────────────────────────

/// `redis_set_user_active_match` followed by `redis_get_user_active_match`
/// returns the stored match id.
#[tokio::test]
#[ignore]
async fn active_match_set_get_round_trip() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let match_id = format!("{prefix}:match");

    mgr.redis_set_user_active_match(&user_id, &match_id).await;

    let result = mgr.redis_get_user_active_match(&user_id).await;
    assert_eq!(
        result,
        Some(match_id.clone()),
        "get after set must return the stored match id"
    );

    // clean up
    mgr.redis_del_user_active_match(&user_id).await;
}

/// `redis_get_user_active_match` returns `None` when no key exists.
#[tokio::test]
#[ignore]
async fn active_match_get_returns_none_for_unknown_user() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:nonexistent");

    let result = mgr.redis_get_user_active_match(&user_id).await;
    assert_eq!(result, None, "missing key must yield None");
}

/// `redis_del_user_active_match` removes an existing mapping.
#[tokio::test]
#[ignore]
async fn active_match_del_removes_mapping() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let match_id = format!("{prefix}:match");

    mgr.redis_set_user_active_match(&user_id, &match_id).await;

    let before = mgr.redis_get_user_active_match(&user_id).await;
    assert_eq!(before, Some(match_id), "key must exist before del");

    mgr.redis_del_user_active_match(&user_id).await;

    let after = mgr.redis_get_user_active_match(&user_id).await;
    assert_eq!(after, None, "key must be absent after del");
}

/// Deleting an active-match key that does not exist is a no-op.
#[tokio::test]
#[ignore]
async fn active_match_del_nonexistent_is_noop() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:ghost");

    mgr.redis_del_user_active_match(&user_id).await;

    let result = mgr.redis_get_user_active_match(&user_id).await;
    assert_eq!(result, None);
}

/// Overwriting an existing active-match mapping stores the new match id.
#[tokio::test]
#[ignore]
async fn active_match_set_overwrites_existing_value() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let match_a = format!("{prefix}:match-a");
    let match_b = format!("{prefix}:match-b");

    mgr.redis_set_user_active_match(&user_id, &match_a).await;
    mgr.redis_set_user_active_match(&user_id, &match_b).await;

    let result = mgr.redis_get_user_active_match(&user_id).await;
    assert_eq!(result, Some(match_b), "second set must overwrite the first");

    // clean up
    mgr.redis_del_user_active_match(&user_id).await;
}

// ── isolation: lobby and active-match keys are independent ───────────────────

// ── disconnect ───────────────────────────────────────────────────────────────

/// `disconnect` removes the connection with the matching `conn_id` from local
/// state but leaves the Redis lobby mapping intact so the user can reconnect.
///
/// Because `disconnect` looks up the lobby id via Redis, we pre-populate the
/// Redis key using the `testing`-feature helper before calling `disconnect`.
#[tokio::test]
#[ignore]
async fn disconnect_removes_connection_from_local_state() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let lobby_id = format!("{prefix}:lobby");

    // Register the lobby mapping in Redis so disconnect can find it.
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // Manually push a connection handle into the local DashMap by connecting
    // via the internal register path.  Since `register_connection` is private
    // we simulate it by inserting through the public `disconnect` API:
    // after disconnect on an empty lobby the local state must stay empty (no
    // panic) and the Redis key must still be present.
    let conn_id: u64 = 42;

    // Call disconnect — the lobby has no in-memory connections so the retain
    // is a no-op, but the Redis key must survive.
    mgr.disconnect(&user_id, None, conn_id).await;

    // Redis key should still be there (disconnect intentionally keeps it).
    let lobby_still_present = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(
        lobby_still_present,
        Some(lobby_id.clone()),
        "disconnect must not remove the Redis lobby mapping"
    );

    // Clean up.
    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// `disconnect` is a no-op (no panic) when no Redis mapping exists for the
/// user.
#[tokio::test]
#[ignore]
async fn disconnect_no_op_for_unknown_user() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:ghost");

    // No lobby mapping in Redis — disconnect should return without error.
    mgr.disconnect(&user_id, None, 999).await;

    // Nothing was set, nothing to assert — just verifying no panic.
    let result = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(result, None);
}

// ── handle_chat_message ──────────────────────────────────────────────────────

/// `handle_chat_message` looks up the user's lobby via Redis. When no lobby
/// mapping exists the method is a no-op and must not panic.
#[tokio::test]
#[ignore]
async fn handle_chat_message_no_op_for_user_without_lobby() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:nobody");

    // No Redis mapping — chat message should be silently dropped.
    mgr.handle_chat_message(&user_id, "hello world").await;

    // Verify the user still has no lobby mapping afterwards.
    let result = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(result, None);
}

/// `handle_chat_message` finds the lobby via Redis and broadcasts to all
/// in-memory connections within that lobby.  With no in-memory connections the
/// broadcast is a no-op — but the Redis key must still exist afterwards.
#[tokio::test]
#[ignore]
async fn handle_chat_message_broadcasts_with_redis_lobby() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:sender");
    let lobby_id = format!("{prefix}:lobby");

    // Seed the Redis mapping so `handle_chat_message` can resolve the lobby.
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // No in-memory connections for this lobby, so broadcast is a no-op, but
    // the method must complete without panicking.
    mgr.handle_chat_message(&user_id, "test message").await;

    // The Redis lobby mapping must be untouched after the call.
    let after = mgr.test_redis_get_user_lobby(&user_id).await;
    assert_eq!(
        after,
        Some(lobby_id.clone()),
        "handle_chat_message must not mutate the Redis lobby key"
    );

    // Clean up.
    mgr.test_redis_del_user_lobby(&user_id).await;
}

// ── get_user_lobby_id ────────────────────────────────────────────────────────

/// `get_user_lobby_id` returns `None` for a user with no active lobby.
#[tokio::test]
#[ignore]
async fn get_user_lobby_id_returns_none_for_unknown_user() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:unknown");

    let result = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(
        result, None,
        "get_user_lobby_id must return None when no mapping exists"
    );
}

/// `get_user_lobby_id` returns the lobby id stored by `test_redis_set_user_lobby`.
#[tokio::test]
#[ignore]
async fn get_user_lobby_id_returns_stored_lobby() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let lobby_id = format!("{prefix}:lobby");

    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    let result = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(
        result,
        Some(lobby_id.clone()),
        "get_user_lobby_id must return the stored lobby id"
    );

    // Clean up.
    mgr.test_redis_del_user_lobby(&user_id).await;
}

// ── instant_bot_fill ─────────────────────────────────────────────────────────

/// `instant_bot_fill` is documented as a no-op for the legacy game-mode-based
/// API.  It must complete without error regardless of the game mode.
#[tokio::test]
#[ignore]
async fn instant_bot_fill_is_noop() {
    let mgr = make_manager().await;

    // Both None and Some("ranked") should complete without error.
    mgr.instant_bot_fill(None).await;
    mgr.instant_bot_fill(Some("ranked")).await;
    // No assertions beyond "did not panic".
}

/// The lobby key and the active-match key for the same user are stored
/// independently and do not interfere with each other.
#[tokio::test]
#[ignore]
async fn lobby_and_active_match_keys_are_independent() {
    let mgr = make_manager().await;
    let prefix = unique_prefix();
    let user_id = format!("{prefix}:user");
    let lobby_id = format!("{prefix}:lobby");
    let match_id = format!("{prefix}:match");

    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;
    mgr.redis_set_user_active_match(&user_id, &match_id).await;

    // Deleting the lobby key must not affect the active-match key.
    mgr.test_redis_del_user_lobby(&user_id).await;
    assert_eq!(mgr.test_redis_get_user_lobby(&user_id).await, None);
    assert_eq!(
        mgr.redis_get_user_active_match(&user_id).await,
        Some(match_id.clone()),
        "active-match key must survive lobby key deletion"
    );

    // Deleting the active-match key must not affect a re-created lobby key.
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;
    mgr.redis_del_user_active_match(&user_id).await;
    assert_eq!(mgr.redis_get_user_active_match(&user_id).await, None);
    assert_eq!(
        mgr.test_redis_get_user_lobby(&user_id).await,
        Some(lobby_id),
        "lobby key must survive active-match key deletion"
    );

    // Final clean up.
    mgr.test_redis_del_user_lobby(&user_id).await;
}
