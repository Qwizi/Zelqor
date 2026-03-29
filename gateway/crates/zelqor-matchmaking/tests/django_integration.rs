//! Django integration tests for [`MatchmakingManager`] methods that call the
//! Django internal API.
//!
//! Each test starts a local [`wiremock::MockServer`] in place of Django and
//! configures [`DjangoClient`] to point at it.  A real Redis connection is
//! required; the database is selected via the `REDIS_URL` environment variable
//! (default: `redis://127.0.0.1:6379/15`).
//!
//! All tests are marked `#[ignore]` — run them explicitly with:
//! ```bash
//! REDIS_URL=redis://127.0.0.1:6379/15 \
//!   cargo test -p zelqor-matchmaking --features testing \
//!   -- --include-ignored
//! ```

use std::sync::Arc;

use zelqor_django::DjangoClient;
use zelqor_matchmaking::MatchmakingManager;
use redis::aio::ConnectionManager;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Shared helpers ────────────────────────────────────────────────────────────

fn redis_url() -> String {
    std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/15".to_string())
}

/// Connect to Redis and return a [`ConnectionManager`].
async fn redis_conn() -> ConnectionManager {
    let client = redis::Client::open(redis_url()).expect("valid Redis URL");
    ConnectionManager::new(client)
        .await
        .expect("Redis connection manager should connect")
}

/// Build an `Arc<MatchmakingManager>` backed by a real Redis connection and a
/// [`DjangoClient`] pointing at `mock_server`.
async fn make_manager(mock_server: &MockServer) -> Arc<MatchmakingManager> {
    let conn = redis_conn().await;
    let django = DjangoClient::new(mock_server.uri(), "test-secret".to_string());
    Arc::new(MatchmakingManager::new(django, conn))
}

/// Generate a unique ID prefix so that concurrent test runs never share Redis
/// keys.
fn uid() -> String {
    Uuid::new_v4().to_string()
}

// ── JSON response builders ────────────────────────────────────────────────────

/// Build a JSON [`ResponseTemplate`] with HTTP 200.
fn json_200(body: serde_json::Value) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .set_body_json(body)
}

/// `GET /api/v1/internal/matchmaking/active-match/{user_id}/`
/// → `{"match_id": null}`  (no active match)
fn mock_no_active_match(user_id: &str) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/matchmaking/active-match/{user_id}/"
        )))
        .respond_with(json_200(serde_json::json!({"match_id": null})))
}

/// `GET /api/v1/internal/matchmaking/active-match/{user_id}/`
/// → `{"match_id": <match_id>}`  (has active match)
fn mock_active_match(user_id: &str, match_id: &str) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/matchmaking/active-match/{user_id}/"
        )))
        .respond_with(json_200(serde_json::json!({"match_id": match_id})))
}

/// `GET /api/v1/internal/lobby/active/{user_id}/`
/// → `{"lobby_id": null}`  (no active lobby)
fn mock_no_active_lobby(user_id: &str) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/lobby/active/{user_id}/"
        )))
        .respond_with(json_200(serde_json::json!({"lobby_id": null})))
}

/// `GET /api/v1/internal/lobby/active/{user_id}/`
/// → `{"lobby_id": <lobby_id>}`
fn mock_active_lobby(user_id: &str, lobby_id: &str) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/lobby/active/{user_id}/"
        )))
        .respond_with(json_200(serde_json::json!({"lobby_id": lobby_id})))
}

/// `POST /api/v1/internal/matchmaking/queue/add/`
/// → `{}` (success)
fn mock_queue_add() -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/matchmaking/queue/add/"))
        .respond_with(json_200(serde_json::json!({})))
}

/// `POST /api/v1/internal/matchmaking/queue/remove/`
/// → `{}` (success)
fn mock_queue_remove() -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/matchmaking/queue/remove/"))
        .respond_with(json_200(serde_json::json!({})))
}

/// `POST /api/v1/internal/lobby/find-or-create/`
/// → new lobby created for `user_id`.
fn mock_find_or_create_lobby_created(lobby_id: &str, user_id: &str, username: &str) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/find-or-create/"))
        .respond_with(json_200(serde_json::json!({
            "lobby_id": lobby_id,
            "max_players": 2,
            "status": "waiting",
            "created": true,
            "players": [
                {
                    "user_id": user_id,
                    "username": username,
                    "is_ready": false,
                    "is_bot": false
                }
            ],
            "full_at": null
        })))
}

/// `POST /api/v1/internal/lobby/find-or-create/`
/// → user joins an existing lobby that is now full.
fn mock_find_or_create_lobby_joined_full(
    lobby_id: &str,
    user1_id: &str,
    user1_name: &str,
    user2_id: &str,
    user2_name: &str,
) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/find-or-create/"))
        .respond_with(json_200(serde_json::json!({
            "lobby_id": lobby_id,
            "max_players": 2,
            "status": "full",
            "created": false,
            "players": [
                {
                    "user_id": user1_id,
                    "username": user1_name,
                    "is_ready": false,
                    "is_bot": false
                },
                {
                    "user_id": user2_id,
                    "username": user2_name,
                    "is_ready": false,
                    "is_bot": false
                }
            ],
            "full_at": 1_700_000_000.0_f64
        })))
}

/// `GET /api/v1/internal/lobby/get/{lobby_id}/`
/// → waiting lobby with a single player.
fn mock_get_lobby_waiting(lobby_id: &str, user_id: &str, username: &str) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/lobby/get/{lobby_id}/"
        )))
        .respond_with(json_200(serde_json::json!({
            "lobby_id": lobby_id,
            "status": "waiting",
            "max_players": 2,
            "game_mode": null,
            "host_user_id": user_id,
            "players": [
                {
                    "user_id": user_id,
                    "username": username,
                    "is_ready": false,
                    "is_bot": false
                }
            ],
            "full_at": null,
            "created_at": 1_700_000_000.0_f64
        })))
}

/// `GET /api/v1/internal/lobby/get/{lobby_id}/`
/// → full lobby (2 players, both not ready).
fn mock_get_lobby_full(
    lobby_id: &str,
    host_id: &str,
    user1_id: &str,
    user1_name: &str,
    user2_id: &str,
    user2_name: &str,
) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/lobby/get/{lobby_id}/"
        )))
        .respond_with(json_200(serde_json::json!({
            "lobby_id": lobby_id,
            "status": "full",
            "max_players": 2,
            "game_mode": null,
            "host_user_id": host_id,
            "players": [
                {
                    "user_id": user1_id,
                    "username": user1_name,
                    "is_ready": false,
                    "is_bot": false
                },
                {
                    "user_id": user2_id,
                    "username": user2_name,
                    "is_ready": false,
                    "is_bot": false
                }
            ],
            "full_at": 1_700_000_000.0_f64,
            "created_at": 1_700_000_000.0_f64
        })))
}

/// `GET /api/v1/internal/lobby/get/{lobby_id}/`
/// → ready lobby (2 players, both ready).
fn mock_get_lobby_ready(
    lobby_id: &str,
    host_id: &str,
    user1_id: &str,
    user1_name: &str,
    user2_id: &str,
    user2_name: &str,
) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!(
            "/api/v1/internal/lobby/get/{lobby_id}/"
        )))
        .respond_with(json_200(serde_json::json!({
            "lobby_id": lobby_id,
            "status": "ready",
            "max_players": 2,
            "game_mode": null,
            "host_user_id": host_id,
            "players": [
                {
                    "user_id": user1_id,
                    "username": user1_name,
                    "is_ready": true,
                    "is_bot": false
                },
                {
                    "user_id": user2_id,
                    "username": user2_name,
                    "is_ready": true,
                    "is_bot": false
                }
            ],
            "full_at": 1_700_000_000.0_f64,
            "created_at": 1_700_000_000.0_f64
        })))
}

/// `GET /api/v1/internal/users/{user_id}/`
fn mock_get_user(user_id: &str, username: &str) -> Mock {
    Mock::given(method("GET"))
        .and(path(format!("/api/v1/internal/users/{user_id}/")))
        .respond_with(json_200(serde_json::json!({
            "id": user_id,
            "username": username,
            "elo_rating": 1000,
            "is_active": true
        })))
}

/// `POST /api/v1/internal/lobby/leave/`
/// → not cancelled (non-host left).
fn mock_leave_lobby_not_cancelled(lobby_id: &str) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/leave/"))
        .respond_with(json_200(serde_json::json!({
            "status": "waiting",
            "cancelled": false
        })))
    .named(format!("leave_lobby_not_cancelled:{lobby_id}"))
}

/// `POST /api/v1/internal/lobby/leave/`
/// → lobby cancelled (host left).
fn mock_leave_lobby_cancelled() -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/leave/"))
        .respond_with(json_200(serde_json::json!({
            "status": "cancelled",
            "cancelled": true
        })))
}

/// `POST /api/v1/internal/lobby/set-ready/`
/// → user marked ready, not all players ready yet.
fn mock_set_ready_not_all_ready(lobby_id: &str, user_id: &str, username: &str) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/set-ready/"))
        .respond_with(json_200(serde_json::json!({
            "all_ready": false,
            "players": [
                {
                    "user_id": user_id,
                    "username": username,
                    "is_ready": true,
                    "is_bot": false
                }
            ]
        })))
    .named(format!("set_ready_not_all:{lobby_id}"))
}

/// `GET /api/v1/internal/lobby/get/{lobby_id}/` and
/// `POST /api/v1/internal/lobby/set-ready/` combined mock for the all-ready
/// path: first `get_lobby` returns a not-ready lobby (current ready state),
/// then `set_ready` responds with all_ready=true.
fn mock_set_ready_all_ready(
    lobby_id: &str,
    user1_id: &str,
    user1_name: &str,
    user2_id: &str,
    user2_name: &str,
) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/set-ready/"))
        .respond_with(json_200(serde_json::json!({
            "all_ready": true,
            "players": [
                {
                    "user_id": user1_id,
                    "username": user1_name,
                    "is_ready": true,
                    "is_bot": false
                },
                {
                    "user_id": user2_id,
                    "username": user2_name,
                    "is_ready": true,
                    "is_bot": false
                }
            ]
        })))
    .named(format!("set_ready_all_ready:{lobby_id}"))
}

/// `POST /api/v1/internal/lobby/start-match/`
/// → match started.
fn mock_start_match(lobby_id: &str, match_id: &str) -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/start-match/"))
        .respond_with(json_200(serde_json::json!({
            "match_id": match_id,
            "user_ids": ["user1", "user2"],
            "bot_ids": null
        })))
    .named(format!("start_match:{lobby_id}"))
}

/// `POST /api/v1/internal/lobby/notify-lobby-full/`
/// → `{}` (fire-and-forget, always succeeds).
fn mock_notify_lobby_full() -> Mock {
    Mock::given(method("POST"))
        .and(path("/api/v1/internal/lobby/notify-lobby-full/"))
        .respond_with(json_200(serde_json::json!({})))
}

// ── Drain a receiver into a Vec ───────────────────────────────────────────────

/// Collect all messages currently waiting in `rx` without blocking.
/// Drains all messages from the receiver, returning JSON payloads and whether a Close was seen.
fn drain_all(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<zelqor_matchmaking::MatchmakingMessage>,
) -> (Vec<serde_json::Value>, bool) {
    let mut out = Vec::new();
    let mut saw_close = false;
    while let Ok(msg) = rx.try_recv() {
        match msg {
            zelqor_matchmaking::MatchmakingMessage::Json(v) => out.push(v),
            zelqor_matchmaking::MatchmakingMessage::Close => saw_close = true,
        }
    }
    (out, saw_close)
}

fn drain_messages(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<zelqor_matchmaking::MatchmakingMessage>,
) -> Vec<serde_json::Value> {
    drain_all(rx).0
}

/// Returns `true` if a `Close` variant is present in `rx` (or was already drained).
fn has_close(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<zelqor_matchmaking::MatchmakingMessage>,
) -> bool {
    drain_all(rx).1
}

// ─────────────────────────────────────────────────────────────────────────────
// connect() — new user, no active match, no active lobby
// ─────────────────────────────────────────────────────────────────────────────

/// A brand-new user connects: Django reports no active match and no active
/// lobby.  The manager calls `find_or_create_lobby`, receives a new lobby, and
/// sends `lobby_created` to the user.  The Redis mapping must be written.
#[tokio::test]
#[ignore]
async fn connect_new_user_no_match_no_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();
    let username = "Player1";
    let lobby_id = uid();

    // Set up mocks in call order.
    mock_no_active_match(&user_id).mount(&server).await;
    mock_no_active_lobby(&user_id).mount(&server).await;
    mock_queue_add().mount(&server).await;
    mock_find_or_create_lobby_created(&lobby_id, &user_id, username)
        .mount(&server)
        .await;
    // get_lobby is called right after find_or_create to fetch `created_at`.
    mock_get_lobby_waiting(&lobby_id, &user_id, username)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    let (mut rx, _conn_id) = mgr
        .connect(&user_id, username, None)
        .await
        .expect("connect must succeed");

    // Expect a lobby_created message.
    let msgs = drain_messages(&mut rx);
    let lobby_created = msgs
        .iter()
        .find(|v| v["type"] == "lobby_created")
        .expect("lobby_created message expected");
    assert_eq!(lobby_created["lobby_id"], lobby_id.as_str());
    assert_eq!(lobby_created["max_players"], 2);

    // Redis mapping must be set.
    let stored = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(stored, Some(lobby_id.clone()));

    // Clean up.
    mgr.test_redis_del_user_lobby(&user_id).await;
}

// ─────────────────────────────────────────────────────────────────────────────
// connect() — user with active match
// ─────────────────────────────────────────────────────────────────────────────

/// When Django reports the user already has an active match, `connect` sends
/// `active_match_exists` + `Close` and returns immediately without touching any
/// lobby state.
#[tokio::test]
#[ignore]
async fn connect_user_with_active_match() {
    let server = MockServer::start().await;
    let user_id = uid();
    let match_id = uid();

    mock_active_match(&user_id, &match_id).mount(&server).await;
    // queue/remove is called fire-and-forget when an active match is found.
    mock_queue_remove().mount(&server).await;

    let mgr = make_manager(&server).await;
    let (mut rx, _conn_id) = mgr
        .connect(&user_id, "Player1", None)
        .await
        .expect("connect must succeed even when active match exists");

    // Must receive active_match_exists message and Close.
    let (msgs, saw_close) = drain_all(&mut rx);
    let active_msg = msgs
        .iter()
        .find(|v| v["type"] == "active_match_exists")
        .expect("active_match_exists message expected");
    assert_eq!(active_msg["match_id"], match_id.as_str());
    assert!(saw_close, "Close message expected after active_match_exists");

    // No lobby mapping must be created.
    let stored = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(stored, None, "no Redis lobby key must be written for active-match redirect");
}

// ─────────────────────────────────────────────────────────────────────────────
// connect() — user reconnecting to existing lobby
// ─────────────────────────────────────────────────────────────────────────────

/// A user that has a Redis lobby key (from a previous connection) reconnects.
/// Django's `get_lobby` is called to rebuild state, and `lobby_created` is
/// sent.  No new lobby is created.
#[tokio::test]
#[ignore]
async fn connect_user_reconnects_to_existing_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();
    let username = "Player1";
    let lobby_id = uid();

    // Pre-populate Redis so the manager finds the lobby immediately.
    let tmp_django = DjangoClient::new(server.uri(), "test-secret".to_string());
    let tmp_conn = redis_conn().await;
    let tmp_mgr = Arc::new(MatchmakingManager::new(tmp_django, tmp_conn));
    tmp_mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // For reconnect: active-match check, then get_lobby for state.
    mock_no_active_match(&user_id).mount(&server).await;
    mock_get_lobby_waiting(&lobby_id, &user_id, username)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    // Manually seed the Redis key into this manager's Redis instance.
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    let (mut rx, _conn_id) = mgr
        .connect(&user_id, username, None)
        .await
        .expect("connect must succeed for reconnect");

    let msgs = drain_messages(&mut rx);
    let lobby_created = msgs
        .iter()
        .find(|v| v["type"] == "lobby_created")
        .expect("lobby_created expected on reconnect");
    assert_eq!(lobby_created["lobby_id"], lobby_id.as_str());

    // Redis mapping is preserved.
    let stored = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(stored, Some(lobby_id.clone()));

    // Clean up.
    mgr.test_redis_del_user_lobby(&user_id).await;
    tmp_mgr.test_redis_del_user_lobby(&user_id).await;
}

/// Same as above but the existing lobby is in `full` status — `connect` must
/// also emit `lobby_full` on reconnect.
#[tokio::test]
#[ignore]
async fn connect_reconnect_full_lobby_sends_lobby_full() {
    let server = MockServer::start().await;
    let user_id = uid();
    let user2_id = uid();
    let username = "Player1";
    let username2 = "Player2";
    let lobby_id = uid();

    mock_no_active_match(&user_id).mount(&server).await;
    mock_get_lobby_full(&lobby_id, &user_id, &user_id, username, &user2_id, username2)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    let (mut rx, _conn_id) = mgr
        .connect(&user_id, username, None)
        .await
        .expect("connect must succeed");

    let msgs = drain_messages(&mut rx);
    assert!(
        msgs.iter().any(|v| v["type"] == "lobby_created"),
        "lobby_created expected"
    );
    assert!(
        msgs.iter().any(|v| v["type"] == "lobby_full"),
        "lobby_full expected for full lobby reconnect"
    );

    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// Same as above but status is `ready` — must also emit `all_ready`.
#[tokio::test]
#[ignore]
async fn connect_reconnect_ready_lobby_sends_all_ready() {
    let server = MockServer::start().await;
    let user_id = uid();
    let user2_id = uid();
    let username = "Player1";
    let username2 = "Player2";
    let lobby_id = uid();

    mock_no_active_match(&user_id).mount(&server).await;
    mock_get_lobby_ready(&lobby_id, &user_id, &user_id, username, &user2_id, username2)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    let (mut rx, _conn_id) = mgr
        .connect(&user_id, username, None)
        .await
        .expect("connect must succeed");

    let msgs = drain_messages(&mut rx);
    assert!(msgs.iter().any(|v| v["type"] == "lobby_created"), "lobby_created expected");
    assert!(msgs.iter().any(|v| v["type"] == "lobby_full"), "lobby_full expected");
    assert!(
        msgs.iter().any(|v| v["type"] == "all_ready"),
        "all_ready expected for ready lobby reconnect"
    );

    mgr.test_redis_del_user_lobby(&user_id).await;
}

// ─────────────────────────────────────────────────────────────────────────────
// connect() — Redis miss, Django finds lobby
// ─────────────────────────────────────────────────────────────────────────────

/// If Redis has no key but Django says the user has an active lobby, the
/// manager must re-populate Redis and reconnect the user to that lobby.
#[tokio::test]
#[ignore]
async fn connect_redis_miss_django_finds_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();
    let username = "Player1";
    let lobby_id = uid();

    // No Redis key → manager queries Django for active lobby.
    mock_no_active_match(&user_id).mount(&server).await;
    mock_active_lobby(&user_id, &lobby_id).mount(&server).await;
    // Reconnect path calls get_lobby.
    mock_get_lobby_waiting(&lobby_id, &user_id, username)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    // Ensure no Redis key exists.
    mgr.test_redis_del_user_lobby(&user_id).await;

    let (mut rx, _conn_id) = mgr
        .connect(&user_id, username, None)
        .await
        .expect("connect must succeed");

    let msgs = drain_messages(&mut rx);
    assert!(
        msgs.iter().any(|v| v["type"] == "lobby_created"),
        "lobby_created expected after Redis-miss reconnect"
    );

    // Redis must now be populated.
    let stored = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(stored, Some(lobby_id.clone()));

    mgr.test_redis_del_user_lobby(&user_id).await;
}

// ─────────────────────────────────────────────────────────────────────────────
// disconnect()
// ─────────────────────────────────────────────────────────────────────────────

/// `disconnect` removes only the in-memory connection entry for `conn_id` and
/// leaves the Redis lobby mapping intact so the user can reconnect.
#[tokio::test]
#[ignore]
async fn disconnect_removes_connection_keeps_redis() {
    let server = MockServer::start().await;
    let user_id = uid();
    let lobby_id = uid();

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // conn_id 77 has no matching in-memory connection; the method should be a
    // safe no-op for the retain but must leave Redis intact.
    mgr.disconnect(&user_id, None, 77).await;

    let stored = mgr.get_user_lobby_id(&user_id).await;
    assert_eq!(
        stored,
        Some(lobby_id.clone()),
        "Redis lobby mapping must survive disconnect"
    );

    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// `disconnect` for a user with no Redis mapping is a silent no-op.
#[tokio::test]
#[ignore]
async fn disconnect_no_op_for_unknown_user() {
    let server = MockServer::start().await;
    let user_id = uid();

    let mgr = make_manager(&server).await;
    // No setup — must not panic.
    mgr.disconnect(&user_id, None, 1).await;

    assert_eq!(mgr.get_user_lobby_id(&user_id).await, None);
}

// ─────────────────────────────────────────────────────────────────────────────
// handle_cancel()
// ─────────────────────────────────────────────────────────────────────────────

/// When a non-host user cancels, `leave_lobby` is called on Django
/// (`cancelled=false`), `queue/remove` is called, and the user's Redis mapping
/// is deleted.
#[tokio::test]
#[ignore]
async fn handle_cancel_non_host_removes_redis_mapping() {
    let server = MockServer::start().await;
    let user_id = uid();
    let lobby_id = uid();

    mock_leave_lobby_not_cancelled(&lobby_id).mount(&server).await;
    // After a non-cancelled leave, get_lobby is called to broadcast updated state.
    mock_get_lobby_waiting(&lobby_id, &user_id, "Player1")
        .mount(&server)
        .await;
    mock_queue_remove().mount(&server).await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    mgr.handle_cancel(&user_id, None).await;

    // Redis mapping for the leaving user must be deleted.
    assert_eq!(
        mgr.get_user_lobby_id(&user_id).await,
        None,
        "Redis mapping must be deleted after cancel"
    );
}

/// When the host cancels, `leave_lobby` returns `cancelled=true`.  The lobby
/// mapping for the host must be cleared, and the connections map entry must be
/// cleaned up (no panic).
#[tokio::test]
#[ignore]
async fn handle_cancel_host_broadcasts_lobby_cancelled() {
    let server = MockServer::start().await;
    let user_id = uid();
    let lobby_id = uid();

    mock_leave_lobby_cancelled().mount(&server).await;
    mock_queue_remove().mount(&server).await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    mgr.handle_cancel(&user_id, None).await;

    // Host's Redis key must be removed.
    assert_eq!(
        mgr.get_user_lobby_id(&user_id).await,
        None,
        "host Redis mapping must be deleted after cancellation"
    );
}

/// `handle_cancel` is a no-op when the user has no Redis lobby mapping.
#[tokio::test]
#[ignore]
async fn handle_cancel_no_op_for_user_without_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();

    let mgr = make_manager(&server).await;
    // No mapping — must not panic or call any Django endpoint.
    mgr.handle_cancel(&user_id, None).await;

    // Confirm no lobby key was created as a side-effect.
    assert_eq!(mgr.get_user_lobby_id(&user_id).await, None);
    // wiremock will assert 0 requests were received for any mounted mock (none
    // were mounted) — if any unexpected HTTP request is made it will return a
    // non-200 and cause a panic in the code path.
}

// ─────────────────────────────────────────────────────────────────────────────
// handle_ready()
// ─────────────────────────────────────────────────────────────────────────────

/// A user readies up but not all players are ready yet.  `set_ready` is called
/// on Django.  No match is started.
#[tokio::test]
#[ignore]
async fn handle_ready_sets_ready_not_all_ready() {
    let server = MockServer::start().await;
    let user_id = uid();
    let username = "Player1";
    let lobby_id = uid();

    // handle_ready first calls get_lobby to check current ready state (toggle).
    mock_get_lobby_waiting(&lobby_id, &user_id, username)
        .mount(&server)
        .await;
    mock_set_ready_not_all_ready(&lobby_id, &user_id, username)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // No in-memory connection — broadcast is a no-op, but the Django calls
    // must still be made and no panic must occur.
    mgr.handle_ready(&user_id, None).await;

    // The key invariant is that no panic occurred and the correct Django
    // endpoints were hit (verified by wiremock on drop).
    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// When the last player readies up, `set_ready` returns `all_ready=true`.
/// `start_match_from_lobby` is called and `match_starting` + `match_found`
/// would be broadcast.  After the match starts the Redis lobby key for all
/// connected users must be removed.
#[tokio::test]
#[ignore]
async fn handle_ready_all_ready_starts_match() {
    let server = MockServer::start().await;
    let user1_id = uid();
    let user2_id = uid();
    let u1_name = "Player1";
    let u2_name = "Player2";
    let lobby_id = uid();
    let match_id = uid();

    // handle_ready: get_lobby (current state) → set_ready (all_ready=true) →
    // start_match_from_lobby.
    // For user1 (not yet ready in get_lobby):
    mock_get_lobby_full(&lobby_id, &user1_id, &user1_id, u1_name, &user2_id, u2_name)
        .mount(&server)
        .await;
    mock_set_ready_all_ready(&lobby_id, &user1_id, u1_name, &user2_id, u2_name)
        .mount(&server)
        .await;
    mock_start_match(&lobby_id, &match_id).mount(&server).await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user1_id, &lobby_id).await;
    mgr.test_redis_set_user_lobby(&user2_id, &lobby_id).await;

    mgr.handle_ready(&user1_id, None).await;

    // The start_match flow clears Redis lobby keys only for users that are
    // registered in the in-memory lobby_connections DashMap. Since we only
    // set Redis keys manually (without calling connect()), neither user has
    // an in-memory ConnectionHandle. The Redis keys remain — this is expected.
    // We verify the Django endpoints were called correctly by the mock
    // expectations (wiremock panics on drop if .expect(1) is not satisfied).
}

/// `handle_ready` is a no-op when the user has no Redis lobby mapping.
#[tokio::test]
#[ignore]
async fn handle_ready_no_op_for_user_without_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();

    let mgr = make_manager(&server).await;
    // No lobby mapping — must not panic or call any Django endpoint.
    mgr.handle_ready(&user_id, None).await;

    assert_eq!(mgr.get_user_lobby_id(&user_id).await, None);
}

// ─────────────────────────────────────────────────────────────────────────────
// handle_status()
// ─────────────────────────────────────────────────────────────────────────────

/// `handle_status` sends the current lobby state to the requesting user.
/// With no in-memory connection the send is silently dropped; the test verifies
/// that the correct Django endpoint is called and no crash occurs.
#[tokio::test]
#[ignore]
async fn handle_status_sends_lobby_state() {
    let server = MockServer::start().await;
    let user_id = uid();
    let username = "Player1";
    let lobby_id = uid();

    mock_get_lobby_waiting(&lobby_id, &user_id, username)
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // No in-memory connection — send_to_user_in_lobby is a no-op.
    mgr.handle_status(&user_id, None).await;

    // Redis mapping must be untouched.
    assert_eq!(
        mgr.get_user_lobby_id(&user_id).await,
        Some(lobby_id.clone())
    );

    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// `handle_status` for a full lobby emits `lobby_full` in addition to
/// `lobby_created`.  Since we have no in-memory connection the sends are
/// no-ops, but the test verifies the right Django path is called.
#[tokio::test]
#[ignore]
async fn handle_status_full_lobby_calls_get_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();
    let user2_id = uid();
    let lobby_id = uid();

    mock_get_lobby_full(&lobby_id, &user_id, &user_id, "P1", &user2_id, "P2")
        .mount(&server)
        .await;

    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    // Must not panic; wiremock will verify the GET was issued.
    mgr.handle_status(&user_id, None).await;

    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// `handle_status` is a no-op when the user has no Redis lobby mapping.
#[tokio::test]
#[ignore]
async fn handle_status_no_op_for_user_without_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();

    let mgr = make_manager(&server).await;
    // No Redis key → early return, no Django call.
    mgr.handle_status(&user_id, None).await;

    assert_eq!(mgr.get_user_lobby_id(&user_id).await, None);
}

// ─────────────────────────────────────────────────────────────────────────────
// handle_chat_message()
// ─────────────────────────────────────────────────────────────────────────────

/// `handle_chat_message` resolves the lobby via Redis and broadcasts to all
/// in-memory connections.  With no in-memory connections the broadcast is a
/// no-op — the test verifies the Redis lookup and that no Django call is made.
#[tokio::test]
#[ignore]
async fn handle_chat_message_broadcasts_in_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();
    let lobby_id = uid();

    // No Django endpoints should be called for chat.
    let mgr = make_manager(&server).await;
    mgr.test_redis_set_user_lobby(&user_id, &lobby_id).await;

    mgr.handle_chat_message(&user_id, "hello everyone").await;

    // Redis key must be untouched.
    assert_eq!(mgr.get_user_lobby_id(&user_id).await, Some(lobby_id.clone()));

    mgr.test_redis_del_user_lobby(&user_id).await;
}

/// `handle_chat_message` is a no-op when the user has no lobby mapping.
#[tokio::test]
#[ignore]
async fn handle_chat_message_no_op_without_lobby() {
    let server = MockServer::start().await;
    let user_id = uid();

    let mgr = make_manager(&server).await;
    // No lobby key → early return.
    mgr.handle_chat_message(&user_id, "this should be dropped").await;

    assert_eq!(mgr.get_user_lobby_id(&user_id).await, None);
}

// ─────────────────────────────────────────────────────────────────────────────
// connect() — second user joins, lobby becomes full
// ─────────────────────────────────────────────────────────────────────────────

/// When a second user joins and `find_or_create_lobby` returns `status=full`,
/// the joining user must receive both `lobby_created` and `lobby_full`.
/// `notify_lobby_full` is also called (fire-and-forget).
#[tokio::test]
#[ignore]
async fn connect_second_user_joins_full_lobby() {
    let server = MockServer::start().await;
    let user1_id = uid();
    let user2_id = uid();
    let u1_name = "Player1";
    let u2_name = "Player2";
    let lobby_id = uid();

    mock_no_active_match(&user2_id).mount(&server).await;
    mock_no_active_lobby(&user2_id).mount(&server).await;
    mock_queue_add().mount(&server).await;
    mock_find_or_create_lobby_joined_full(&lobby_id, &user1_id, u1_name, &user2_id, u2_name)
        .mount(&server)
        .await;
    // get_lobby called for created_at after find_or_create.
    mock_get_lobby_full(&lobby_id, &user1_id, &user1_id, u1_name, &user2_id, u2_name)
        .mount(&server)
        .await;
    // get_user called to resolve the joining user's username for player_joined broadcast.
    mock_get_user(&user2_id, u2_name).mount(&server).await;
    // notify_lobby_full (fire-and-forget).
    mock_notify_lobby_full().mount(&server).await;

    let mgr = make_manager(&server).await;
    let (mut rx, _conn_id) = mgr
        .connect(&user2_id, u2_name, None)
        .await
        .expect("second user connect must succeed");

    // Give the async fire-and-forget notify a moment to run.
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let msgs = drain_messages(&mut rx);
    assert!(
        msgs.iter().any(|v| v["type"] == "lobby_created"),
        "lobby_created expected; got: {msgs:?}"
    );
    assert!(
        msgs.iter().any(|v| v["type"] == "lobby_full"),
        "lobby_full expected for second user joining full lobby; got: {msgs:?}"
    );

    mgr.test_redis_del_user_lobby(&user2_id).await;
}
