use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/// Configuration for the circuit breaker and HTTP retry behaviour.
#[derive(Clone, Debug)]
pub struct DjangoClientConfig {
    /// Per-request timeout in milliseconds (default: 5000).
    pub request_timeout_ms: u64,
    /// Maximum number of retry attempts for 5xx / network errors (default: 3).
    pub retry_count: u32,
    /// Number of consecutive failures before the circuit opens (default: 5).
    pub circuit_failure_threshold: u32,
    /// How long the circuit stays open before allowing a probe (default: 30s).
    pub circuit_reset_timeout_secs: u64,
}

impl Default for DjangoClientConfig {
    fn default() -> Self {
        Self {
            request_timeout_ms: 5000,
            retry_count: 3,
            circuit_failure_threshold: 5,
            circuit_reset_timeout_secs: 30,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CircuitState {
    /// Requests pass through normally.
    Closed,
    /// Circuit tripped — requests fail fast.
    Open,
    /// One probe request allowed to test recovery.
    HalfOpen,
}

struct CircuitBreaker {
    state: RwLock<CircuitState>,
    failure_count: AtomicU32,
    last_failure: RwLock<Option<Instant>>,
    failure_threshold: u32,
    reset_timeout: Duration,
}

impl CircuitBreaker {
    fn new(failure_threshold: u32, reset_timeout_secs: u64) -> Self {
        Self {
            state: RwLock::new(CircuitState::Closed),
            failure_count: AtomicU32::new(0),
            last_failure: RwLock::new(None),
            failure_threshold,
            reset_timeout: Duration::from_secs(reset_timeout_secs),
        }
    }

    /// Returns the effective state, transitioning Open -> HalfOpen if enough
    /// time has elapsed since the last failure.
    async fn effective_state(&self) -> CircuitState {
        let state = *self.state.read().await;
        if state == CircuitState::Open {
            let last = *self.last_failure.read().await;
            if let Some(t) = last {
                if t.elapsed() >= self.reset_timeout {
                    *self.state.write().await = CircuitState::HalfOpen;
                    return CircuitState::HalfOpen;
                }
            }
        }
        state
    }

    /// Record a successful call: reset failure counter and close the circuit.
    async fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
        *self.state.write().await = CircuitState::Closed;
    }

    /// Record a failure: increment counter, open circuit if threshold reached.
    async fn record_failure(&self) {
        let prev = self.failure_count.fetch_add(1, Ordering::Relaxed);
        *self.last_failure.write().await = Some(Instant::now());
        if prev + 1 >= self.failure_threshold {
            *self.state.write().await = CircuitState::Open;
            tracing::warn!(
                failures = prev + 1,
                threshold = self.failure_threshold,
                "DjangoClient circuit breaker opened"
            );
        }
    }
}

/// Client for Django internal API endpoints.
#[derive(Clone)]
pub struct DjangoClient {
    client: Client,
    base_url: String,
    internal_secret: String,
    config: DjangoClientConfig,
    circuit: Arc<CircuitBreaker>,
}

// --- Request/Response types ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub elo_rating: i32,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchPlayerInfo {
    pub user_id: String,
    pub username: String,
    #[serde(default)]
    pub clan_tag: Option<String>,
    pub color: String,
    #[serde(default)]
    pub is_bot: bool,
    /// Building slugs unlocked by blueprints in the player's deck.
    #[serde(default)]
    pub unlocked_buildings: Vec<String>,
    /// Unit slugs unlocked by blueprints in the player's deck.
    #[serde(default)]
    pub unlocked_units: Vec<String>,
    /// Ability scrolls: slug → remaining uses.
    #[serde(default)]
    pub ability_scrolls: HashMap<String, i64>,
    /// Pre-match boosts as raw JSON; deserialized to `ActiveBoost` in the gateway.
    #[serde(default)]
    pub active_boosts: Vec<serde_json::Value>,
    /// Ability levels from deck: ability_slug → level (1-3).
    #[serde(default)]
    pub ability_levels: HashMap<String, i64>,
    /// Building max levels from deck: building_slug → max level (1-3).
    #[serde(default)]
    pub building_levels: HashMap<String, i64>,
    #[serde(default)]
    pub unit_levels: HashMap<String, i64>,
    /// Visual cosmetics metadata — passed through to clients, never processed by the engine.
    #[serde(default)]
    pub cosmetics: HashMap<String, serde_json::Value>,
    /// Team identifier for team-based modes (e.g. "challenger", "defender"). None = free-for-all.
    #[serde(default)]
    pub team: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MatchData {
    pub max_players: u32,
    pub players: Vec<MatchPlayerInfo>,
    pub settings_snapshot: serde_json::Value,
    #[serde(default)]
    pub is_tutorial: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegionInfo {
    pub id: String,
    pub name: String,
    pub country_code: String,
    pub centroid: Option<[f64; 2]>,
    pub is_coastal: bool,
    pub sea_distances: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NeighborMap {
    pub neighbors: HashMap<String, Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TryMatchResult {
    pub match_id: Option<String>,
    pub user_ids: Option<Vec<String>>,
    #[serde(default)]
    pub bot_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FillWithBotsRequest {
    pub game_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FillWithBotsResult {
    pub match_id: Option<String>,
    pub user_ids: Option<Vec<String>>,
    pub bot_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueueCountResult {
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveMatchResult {
    pub match_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VerifyPlayerResult {
    pub is_member: bool,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusUpdateRequest {
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AliveUpdateRequest {
    pub is_alive: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SnapshotRequest {
    pub match_id: String,
    pub tick: u64,
    pub state_data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FinalizeRequest {
    pub match_id: String,
    pub winner_id: Option<String>,
    pub total_ticks: u64,
    pub final_state: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CleanupRequest {
    pub match_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatestSnapshotResponse {
    pub tick: Option<u64>,
    pub state_data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActiveMatchesResult {
    pub match_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessageData {
    pub user_id: String,
    pub username: String,
    pub content: String,
    pub timestamp: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessagesResponse {
    pub messages: Vec<ChatMessageData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateChatMessageRequest {
    pub user_id: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateChatMessageResponse {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub content: String,
    pub timestamp: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueueAddRequest {
    pub user_id: String,
    pub game_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueueRemoveRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TryMatchRequest {
    pub game_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LobbyPlayerInfo {
    pub user_id: String,
    pub username: String,
    pub is_bot: bool,
    pub is_ready: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateLobbyRequest {
    pub user_id: String,
    pub game_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateLobbyResult {
    pub lobby_id: String,
    pub max_players: u32,
    pub players: Vec<LobbyPlayerInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JoinLobbyRequest {
    pub lobby_id: String,
    pub user_id: String,
    #[serde(default)]
    pub is_bot: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JoinLobbyResult {
    pub players: Vec<LobbyPlayerInfo>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LeaveLobbyRequest {
    pub lobby_id: String,
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LeaveLobbyResult {
    pub status: String,
    pub cancelled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetReadyRequest {
    pub lobby_id: String,
    pub user_id: String,
    #[serde(default = "default_true")]
    pub is_ready: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SetReadyResult {
    pub all_ready: bool,
    pub players: Vec<LobbyPlayerInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FillLobbyBotsRequest {
    pub lobby_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FillLobbyBotsResult {
    pub bot_ids: Vec<String>,
    pub players: Vec<LobbyPlayerInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StartMatchFromLobbyRequest {
    pub lobby_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LobbyStateResult {
    pub lobby_id: String,
    pub status: String,
    pub max_players: u32,
    pub game_mode: Option<String>,
    pub host_user_id: String,
    pub players: Vec<LobbyPlayerInfo>,
    pub full_at: Option<f64>,
    #[serde(default)]
    pub created_at: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveLobbyResult {
    pub lobby_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FindOrCreateLobbyResult {
    pub lobby_id: String,
    pub max_players: u32,
    pub status: String,
    pub created: bool,
    pub players: Vec<LobbyPlayerInfo>,
    pub full_at: Option<f64>,
}

impl DjangoClient {
    /// Create a client with default configuration (5s timeout, 3 retries,
    /// circuit threshold 5, reset timeout 30s).
    pub fn new(base_url: String, internal_secret: String) -> Self {
        Self::new_with_config(base_url, internal_secret, DjangoClientConfig::default())
    }

    /// Create a client with explicit configuration.
    pub fn new_with_config(
        base_url: String,
        internal_secret: String,
        config: DjangoClientConfig,
    ) -> Self {
        let client = Client::builder()
            .pool_max_idle_per_host(10)
            .build()
            .expect("Failed to create HTTP client");

        let circuit = Arc::new(CircuitBreaker::new(
            config.circuit_failure_threshold,
            config.circuit_reset_timeout_secs,
        ));

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            internal_secret,
            config,
            circuit,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Compute HMAC-SHA256 signature header value for internal API auth.
    ///
    /// Format: `ts=<unix>,sig=<hex_hmac>`
    /// Signed message: `{timestamp}.{method}.{path}.{body_sha256}`
    fn sign_request(&self, method: &str, path: &str, body: &[u8]) -> String {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let body_hash = {
            use sha2::Digest;
            let mut hasher = Sha256::new();
            hasher.update(body);
            hex::encode(hasher.finalize())
        };

        let message = format!("{ts}.{method}.{path}.{body_hash}");

        let mut mac =
            Hmac::<Sha256>::new_from_slice(self.internal_secret.as_bytes()).expect("HMAC key");
        mac.update(message.as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());

        format!("ts={ts},sig={sig}")
    }

    /// Returns `true` for errors that should be retried (5xx, timeout, network).
    /// 4xx errors are the caller's fault and are never retried.
    fn is_retriable(err: &DjangoError) -> bool {
        match err {
            DjangoError::Timeout => true,
            DjangoError::Request(_) => true,
            DjangoError::Status(code, _) => *code >= 500,
            DjangoError::CircuitOpen => false,
        }
    }

    /// Check the circuit breaker before sending a request. Returns `Err` if
    /// the circuit is open and the reset timeout has not yet elapsed.
    async fn check_circuit(&self) -> Result<(), DjangoError> {
        match self.circuit.effective_state().await {
            CircuitState::Open => Err(DjangoError::CircuitOpen),
            _ => Ok(()),
        }
    }

    /// Execute `f` with timeout + circuit breaker accounting.
    ///
    /// `f` receives a `&Client` and must return a `Result<T, DjangoError>`.
    /// On 5xx / network errors the circuit failure counter is incremented; on
    /// 4xx the counter is *not* incremented (caller error, not backend failure).
    /// On success the counter is reset.
    async fn execute_with_resilience<T, F, Fut>(&self, f: F) -> Result<T, DjangoError>
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = Result<T, DjangoError>>,
    {
        self.check_circuit().await?;

        let timeout = Duration::from_millis(self.config.request_timeout_ms);
        let max_retries = self.config.retry_count;

        let mut attempt = 0u32;
        loop {
            let result = tokio::time::timeout(timeout, f())
                .await
                .unwrap_or(Err(DjangoError::Timeout));

            match &result {
                Ok(_) => {
                    self.circuit.record_success().await;
                    return result;
                }
                Err(err) if !Self::is_retriable(err) => {
                    // 4xx — return immediately, do not penalise the circuit.
                    return result;
                }
                Err(_) => {
                    self.circuit.record_failure().await;
                    attempt += 1;
                    if attempt >= max_retries {
                        return result;
                    }
                    // Check circuit again — it may have just opened.
                    self.check_circuit().await?;
                    // Exponential backoff: 100ms, 200ms, 400ms, …
                    let backoff = Duration::from_millis(100 * (1u64 << attempt.min(6)));
                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }

    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, DjangoError> {
        let url = self.url(path);
        let path_owned = path.to_string();
        let sig = self.sign_request("GET", path, b"");
        self.execute_with_resilience(|| {
            let client = self.client.clone();
            let url = url.clone();
            let sig = sig.clone();
            let path_owned = path_owned.clone();
            async move {
                let resp = client
                    .get(&url)
                    .header("X-Internal-Signature", &sig)
                    .send()
                    .await
                    .map_err(DjangoError::Request)?;

                if !resp.status().is_success() {
                    return Err(DjangoError::Status(
                        resp.status().as_u16(),
                        path_owned.clone(),
                    ));
                }

                resp.json().await.map_err(DjangoError::Request)
            }
        })
        .await
    }

    async fn post<B: Serialize, T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, DjangoError> {
        // Serialize body once so the closure can be called multiple times
        // on retry without re-borrowing the caller's `body`.
        let body_json: serde_json::Value = serde_json::to_value(body)
            .map_err(|e| DjangoError::Status(0, format!("serialization error: {e}")))?;

        let url = self.url(path);
        let path_owned = path.to_string();
        let body_bytes = serde_json::to_vec(&body_json).unwrap_or_default();
        let sig = self.sign_request("POST", path, &body_bytes);
        self.execute_with_resilience(|| {
            let client = self.client.clone();
            let url = url.clone();
            let sig = sig.clone();
            let path_owned = path_owned.clone();
            let body_json = body_json.clone();
            async move {
                let resp = client
                    .post(&url)
                    .header("X-Internal-Signature", &sig)
                    .json(&body_json)
                    .send()
                    .await
                    .map_err(DjangoError::Request)?;

                if !resp.status().is_success() {
                    return Err(DjangoError::Status(
                        resp.status().as_u16(),
                        path_owned.clone(),
                    ));
                }

                resp.json().await.map_err(DjangoError::Request)
            }
        })
        .await
    }

    async fn patch<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), DjangoError> {
        let body_json: serde_json::Value = serde_json::to_value(body)
            .map_err(|e| DjangoError::Status(0, format!("serialization error: {e}")))?;

        let url = self.url(path);
        let path_owned = path.to_string();
        let body_bytes = serde_json::to_vec(&body_json).unwrap_or_default();
        let sig = self.sign_request("PATCH", path, &body_bytes);
        self.execute_with_resilience(|| {
            let client = self.client.clone();
            let url = url.clone();
            let sig = sig.clone();
            let path_owned = path_owned.clone();
            let body_json = body_json.clone();
            async move {
                let resp = client
                    .patch(&url)
                    .header("X-Internal-Signature", &sig)
                    .json(&body_json)
                    .send()
                    .await
                    .map_err(DjangoError::Request)?;

                if !resp.status().is_success() {
                    return Err(DjangoError::Status(
                        resp.status().as_u16(),
                        path_owned.clone(),
                    ));
                }

                Ok(())
            }
        })
        .await
    }

    // --- User endpoints ---

    pub async fn get_user(&self, user_id: &str) -> Result<UserInfo, DjangoError> {
        self.get(&format!("/api/v1/internal/users/{user_id}/")).await
    }

    // --- Match endpoints ---

    pub async fn verify_player(
        &self,
        match_id: &str,
        user_id: &str,
    ) -> Result<VerifyPlayerResult, DjangoError> {
        self.get(&format!(
            "/api/v1/internal/matches/{match_id}/verify-player/{user_id}/"
        ))
        .await
    }

    pub async fn verify_spectator(
        &self,
        match_id: &str,
        user_id: &str,
    ) -> Result<VerifyPlayerResult, DjangoError> {
        self.get(&format!(
            "/api/v1/internal/matches/{match_id}/verify-spectator/{user_id}/"
        ))
        .await
    }

    pub async fn get_match_data(&self, match_id: &str) -> Result<MatchData, DjangoError> {
        self.get(&format!("/api/v1/internal/matches/{match_id}/data/"))
            .await
    }

    pub async fn get_match_regions(
        &self,
        match_id: &str,
    ) -> Result<HashMap<String, RegionInfo>, DjangoError> {
        self.get(&format!("/api/v1/internal/matches/{match_id}/regions/"))
            .await
    }

    pub async fn update_match_status(
        &self,
        match_id: &str,
        status: &str,
    ) -> Result<(), DjangoError> {
        self.patch(
            &format!("/api/v1/internal/matches/{match_id}/status/"),
            &StatusUpdateRequest {
                status: status.to_string(),
            },
        )
        .await
    }

    pub async fn set_player_alive(
        &self,
        match_id: &str,
        user_id: &str,
        is_alive: bool,
    ) -> Result<(), DjangoError> {
        self.patch(
            &format!("/api/v1/internal/matches/{match_id}/players/{user_id}/alive/"),
            &AliveUpdateRequest { is_alive },
        )
        .await
    }

    // --- Neighbor map ---

    pub async fn get_neighbor_map(&self) -> Result<HashMap<String, Vec<String>>, DjangoError> {
        let result: NeighborMap = self.get("/api/v1/internal/regions/neighbors/").await?;
        Ok(result.neighbors)
    }

    // --- Matchmaking endpoints ---

    pub async fn try_match(
        &self,
        game_mode: Option<&str>,
    ) -> Result<TryMatchResult, DjangoError> {
        self.post(
            "/api/v1/internal/matchmaking/try-match/",
            &TryMatchRequest {
                game_mode: game_mode.map(|s| s.to_string()),
            },
        )
        .await
    }

    pub async fn add_to_queue(
        &self,
        user_id: &str,
        game_mode: Option<&str>,
    ) -> Result<(), DjangoError> {
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/matchmaking/queue/add/",
                &QueueAddRequest {
                    user_id: user_id.to_string(),
                    game_mode: game_mode.map(|s| s.to_string()),
                },
            )
            .await?;
        Ok(())
    }

    pub async fn remove_from_queue(&self, user_id: &str) -> Result<(), DjangoError> {
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/matchmaking/queue/remove/",
                &QueueRemoveRequest {
                    user_id: user_id.to_string(),
                },
            )
            .await?;
        Ok(())
    }

    pub async fn fill_with_bots(
        &self,
        game_mode: Option<&str>,
    ) -> Result<FillWithBotsResult, DjangoError> {
        self.post(
            "/api/v1/internal/matchmaking/fill-with-bots/",
            &FillWithBotsRequest {
                game_mode: game_mode.map(|s| s.to_string()),
            },
        )
        .await
    }

    pub async fn get_queue_count(
        &self,
        game_mode: Option<&str>,
    ) -> Result<u32, DjangoError> {
        let path = match game_mode {
            Some(gm) => format!("/api/v1/internal/matchmaking/queue/count/?game_mode={gm}"),
            None => "/api/v1/internal/matchmaking/queue/count/".to_string(),
        };
        let result: QueueCountResult = self.get(&path).await?;
        Ok(result.count)
    }

    pub async fn get_active_match(&self, user_id: &str) -> Result<Option<String>, DjangoError> {
        let result: ActiveMatchResult = self
            .get(&format!(
                "/api/v1/internal/matchmaking/active-match/{user_id}/"
            ))
            .await?;
        Ok(result.match_id)
    }

    // --- Game endpoints ---

    pub async fn save_snapshot(
        &self,
        match_id: &str,
        tick: u64,
        state_data: serde_json::Value,
    ) -> Result<(), DjangoError> {
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/game/snapshot/",
                &SnapshotRequest {
                    match_id: match_id.to_string(),
                    tick,
                    state_data,
                },
            )
            .await?;
        Ok(())
    }

    pub async fn finalize_match(
        &self,
        match_id: &str,
        winner_id: Option<&str>,
        total_ticks: u64,
        final_state: serde_json::Value,
    ) -> Result<(), DjangoError> {
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/game/finalize/",
                &FinalizeRequest {
                    match_id: match_id.to_string(),
                    winner_id: winner_id.map(|s| s.to_string()),
                    total_ticks,
                    final_state,
                },
            )
            .await?;
        Ok(())
    }

    pub async fn cleanup_match(&self, match_id: &str) -> Result<(), DjangoError> {
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/game/cleanup/",
                &CleanupRequest {
                    match_id: match_id.to_string(),
                },
            )
            .await?;
        Ok(())
    }

    /// Update a community server's status in Django DB.
    pub async fn update_server_status(
        &self,
        server_id: &str,
        status: &str,
    ) -> Result<(), DjangoError> {
        #[derive(Serialize)]
        struct Body {
            status: String,
        }
        self.patch(
            &format!("/api/v1/internal/server-status/{server_id}/"),
            &Body {
                status: status.to_string(),
            },
        )
        .await
    }

    pub async fn get_latest_snapshot(
        &self,
        match_id: &str,
    ) -> Result<LatestSnapshotResponse, DjangoError> {
        self.get(&format!(
            "/api/v1/internal/game/latest-snapshot/{match_id}/"
        ))
        .await
    }

    pub async fn list_active_matches(&self) -> Result<Vec<String>, DjangoError> {
        let result: ActiveMatchesResult =
            self.get("/api/v1/internal/game/active-matches/").await?;
        Ok(result.match_ids)
    }

    // --- Chat endpoints ---

    pub async fn get_chat_messages(&self, limit: u32) -> Result<Vec<ChatMessageData>, DjangoError> {
        let result: ChatMessagesResponse = self
            .get(&format!("/api/v1/internal/chat/messages/?limit={limit}"))
            .await?;
        Ok(result.messages)
    }

    pub async fn save_chat_message(
        &self,
        user_id: &str,
        content: &str,
    ) -> Result<CreateChatMessageResponse, DjangoError> {
        self.post(
            "/api/v1/internal/chat/messages/",
            &CreateChatMessageRequest {
                user_id: user_id.to_string(),
                content: content.to_string(),
            },
        )
        .await
    }

    pub async fn get_match_chat_messages(
        &self,
        match_id: &str,
        limit: u32,
    ) -> Result<Vec<ChatMessageData>, DjangoError> {
        let result: ChatMessagesResponse = self
            .get(&format!(
                "/api/v1/internal/chat/matches/{match_id}/messages/?limit={limit}"
            ))
            .await?;
        Ok(result.messages)
    }

    pub async fn save_match_chat_message(
        &self,
        match_id: &str,
        user_id: &str,
        content: &str,
    ) -> Result<CreateChatMessageResponse, DjangoError> {
        self.post(
            &format!("/api/v1/internal/chat/matches/{match_id}/messages/"),
            &CreateChatMessageRequest {
                user_id: user_id.to_string(),
                content: content.to_string(),
            },
        )
        .await
    }

    // --- Lobby endpoints ---

    pub async fn create_lobby(
        &self,
        user_id: &str,
        game_mode: Option<&str>,
    ) -> Result<CreateLobbyResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/create/",
            &CreateLobbyRequest {
                user_id: user_id.to_string(),
                game_mode: game_mode.map(|s| s.to_string()),
            },
        )
        .await
    }

    pub async fn join_lobby(
        &self,
        lobby_id: &str,
        user_id: &str,
        is_bot: bool,
    ) -> Result<JoinLobbyResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/join/",
            &JoinLobbyRequest {
                lobby_id: lobby_id.to_string(),
                user_id: user_id.to_string(),
                is_bot,
            },
        )
        .await
    }

    pub async fn leave_lobby(
        &self,
        lobby_id: &str,
        user_id: &str,
    ) -> Result<LeaveLobbyResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/leave/",
            &LeaveLobbyRequest {
                lobby_id: lobby_id.to_string(),
                user_id: user_id.to_string(),
            },
        )
        .await
    }

    pub async fn set_ready(
        &self,
        lobby_id: &str,
        user_id: &str,
        is_ready: bool,
    ) -> Result<SetReadyResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/set-ready/",
            &SetReadyRequest {
                lobby_id: lobby_id.to_string(),
                user_id: user_id.to_string(),
                is_ready,
            },
        )
        .await
    }

    pub async fn fill_lobby_bots(
        &self,
        lobby_id: &str,
    ) -> Result<FillLobbyBotsResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/fill-bots/",
            &FillLobbyBotsRequest {
                lobby_id: lobby_id.to_string(),
            },
        )
        .await
    }

    pub async fn start_match_from_lobby(
        &self,
        lobby_id: &str,
    ) -> Result<TryMatchResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/start-match/",
            &StartMatchFromLobbyRequest {
                lobby_id: lobby_id.to_string(),
            },
        )
        .await
    }

    pub async fn notify_lobby_full(&self, lobby_id: &str) {
        #[derive(Serialize)]
        struct Req { lobby_id: String }
        let _: Result<serde_json::Value, _> = self.post(
            "/api/v1/internal/lobby/notify-lobby-full/",
            &Req { lobby_id: lobby_id.to_string() },
        ).await;
    }

    pub async fn get_lobby(&self, lobby_id: &str) -> Result<LobbyStateResult, DjangoError> {
        self.get(&format!("/api/v1/internal/lobby/get/{lobby_id}/"))
            .await
    }

    pub async fn get_active_lobby(&self, user_id: &str) -> Result<Option<String>, DjangoError> {
        let result: ActiveLobbyResult = self
            .get(&format!("/api/v1/internal/lobby/active/{user_id}/"))
            .await?;
        Ok(result.lobby_id)
    }

    pub async fn find_or_create_lobby(
        &self,
        user_id: &str,
        game_mode: Option<&str>,
    ) -> Result<FindOrCreateLobbyResult, DjangoError> {
        self.post(
            "/api/v1/internal/lobby/find-or-create/",
            &CreateLobbyRequest {
                user_id: user_id.to_string(),
                game_mode: game_mode.map(|s| s.to_string()),
            },
        )
        .await
    }

    // --- Anticheat endpoints ---

    pub async fn report_anticheat_violation(
        &self,
        match_id: &str,
        player_id: &str,
        violation_kind: &str,
        severity: &str,
        detail: &str,
        tick: i64,
    ) -> Result<(), DjangoError> {
        #[derive(Serialize)]
        struct ReportViolationRequest<'a> {
            match_id: &'a str,
            player_id: &'a str,
            violation_kind: &'a str,
            severity: &'a str,
            detail: &'a str,
            tick: i64,
        }
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/anticheat/report-violation/",
                &ReportViolationRequest {
                    match_id,
                    player_id,
                    violation_kind,
                    severity,
                    detail,
                    tick,
                },
            )
            .await?;
        Ok(())
    }

    pub async fn ban_player(
        &self,
        player_id: &str,
        reason: &str,
    ) -> Result<(), DjangoError> {
        #[derive(Serialize)]
        struct BanPlayerRequest<'a> {
            player_id: &'a str,
            reason: &'a str,
        }
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/anticheat/ban-player/",
                &BanPlayerRequest { player_id, reason },
            )
            .await?;
        Ok(())
    }

    pub async fn compensate_players(
        &self,
        match_id: &str,
        player_ids: &[String],
    ) -> Result<(), DjangoError> {
        #[derive(Serialize)]
        struct CompensateRequest<'a> {
            match_id: &'a str,
            player_ids: &'a [String],
        }
        let _: serde_json::Value = self
            .post(
                "/api/v1/internal/anticheat/compensate/",
                &CompensateRequest { match_id, player_ids },
            )
            .await?;
        Ok(())
    }

    pub async fn find_waiting_lobby(
        &self,
        game_mode: Option<&str>,
    ) -> Result<Option<String>, DjangoError> {
        let path = match game_mode {
            Some(gm) => format!("/api/v1/internal/lobby/find-waiting/?game_mode={gm}"),
            None => "/api/v1/internal/lobby/find-waiting/".to_string(),
        };
        let result: ActiveLobbyResult = self.get(&path).await?;
        Ok(result.lobby_id)
    }

    /// Fetch system module states from Django.
    pub async fn get_system_modules(
        &self,
    ) -> Result<HashMap<String, SystemModuleState>, DjangoError> {
        self.get("/api/v1/internal/game/system-modules/").await
    }

    // --- Server info / dispatch ---

    /// Fetch server metadata from Django to determine if a gamenode is verified.
    pub async fn get_server_info(
        &self,
        server_id: &str,
    ) -> Result<ServerInfoResponse, DjangoError> {
        self.get(&format!("/api/v1/internal/server-info/{server_id}/"))
            .await
    }

    /// Assign a gamenode server to a match after dispatching it.
    pub async fn assign_server_to_match(
        &self,
        match_id: &str,
        server_id: &str,
    ) -> Result<(), DjangoError> {
        #[derive(Serialize)]
        struct Body<'a> {
            server_id: &'a str,
        }
        self.patch(
            &format!("/api/v1/internal/matches/{match_id}/assign-server/"),
            &Body { server_id },
        )
        .await
    }

    /// Fetch the installed plugins for a server from Django.
    ///
    /// Called by the gateway after a gamenode registers so the plugin list can
    /// be pushed over WebSocket (gamenodes never call Django directly).
    pub async fn get_server_plugins(
        &self,
        server_id: &str,
    ) -> Result<ServerPluginsResponse, DjangoError> {
        self.get(&format!(
            "/api/v1/internal/server-plugins/{server_id}/"
        ))
        .await
    }
}

/// State of a system module as returned by Django.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemModuleState {
    pub enabled: bool,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
}

/// Server metadata returned by Django's `/server-info/{id}/` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfoResponse {
    pub server_uuid: String,
    pub is_verified: bool,
    pub region: String,
}

/// Response from Django's `/server-plugins/{id}/` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPluginsResponse {
    pub plugins: Vec<ServerPluginEntry>,
}

/// A single plugin entry as returned by the Django internal API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPluginEntry {
    pub slug: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub hooks: Vec<String>,
    pub permissions: Vec<String>,
    pub min_engine_version: Option<String>,
    pub wasm_url: Option<String>,
    pub wasm_hash: String,
    pub config: serde_json::Value,
    pub priority: i32,
}

#[derive(Debug)]
pub enum DjangoError {
    Request(reqwest::Error),
    Status(u16, String),
    /// The request timed out.
    Timeout,
    /// The circuit breaker is open — requests are failing fast.
    CircuitOpen,
}

impl std::fmt::Display for DjangoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DjangoError::Request(e) => write!(f, "Django request error: {e}"),
            DjangoError::Status(code, path) => {
                write!(f, "Django returned status {code} for {path}")
            }
            DjangoError::Timeout => write!(f, "Django request timed out"),
            DjangoError::CircuitOpen => {
                write!(f, "Django circuit breaker is open — too many recent failures")
            }
        }
    }
}

impl std::error::Error for DjangoError {}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // DjangoClient construction
    // -----------------------------------------------------------------------

    mod client_construction {
        use super::*;

        #[test]
        fn new_stores_base_url_and_secret() {
            let client = DjangoClient::new(
                "http://backend:8000".to_string(),
                "my-internal-secret".to_string(),
            );
            // Verify the stored values are accessible via url() indirectly.
            // We can't inspect private fields, but we can assert construction
            // doesn't panic and that the client is Clone.
            let _cloned = client.clone();
        }

        #[test]
        fn new_trims_trailing_slash_from_base_url() {
            // DjangoClient::new strips trailing slashes so url() doesn't
            // double-slash when a path like "/api/..." is appended.
            let client = DjangoClient::new(
                "http://backend:8000/".to_string(),
                "secret".to_string(),
            );
            // Clone to prove it survives — the real assertion is no panic/build error.
            let _c2 = client.clone();
        }

        #[test]
        fn new_trims_multiple_trailing_slashes() {
            // trim_end_matches('/') removes all trailing slashes.
            let client = DjangoClient::new(
                "http://backend:8000///".to_string(),
                "secret".to_string(),
            );
            let _c2 = client.clone();
        }

        #[test]
        fn clone_produces_independent_value() {
            let client = DjangoClient::new(
                "http://backend:8000".to_string(),
                "secret-a".to_string(),
            );
            let cloned = client.clone();
            // Cloning should not panic; both values are independently valid.
            drop(client);
            drop(cloned);
        }
    }

    // -----------------------------------------------------------------------
    // DjangoError formatting
    // -----------------------------------------------------------------------

    mod django_error_display {
        use super::*;

        #[test]
        fn status_error_includes_code_and_path() {
            let err = DjangoError::Status(404, "/api/v1/internal/users/999/".to_string());
            let msg = err.to_string();
            assert!(msg.contains("404"), "display should include the status code");
            assert!(
                msg.contains("/api/v1/internal/users/999/"),
                "display should include the path"
            );
        }

        #[test]
        fn status_error_503_is_formatted() {
            let err = DjangoError::Status(503, "/api/v1/internal/game/snapshot/".to_string());
            let msg = err.to_string();
            assert!(msg.contains("503"));
        }

        #[test]
        fn django_error_implements_std_error() {
            // Compile-time check: DjangoError must satisfy std::error::Error.
            let err: Box<dyn std::error::Error> =
                Box::new(DjangoError::Status(500, "/path/".to_string()));
            assert!(err.to_string().contains("500"));
        }
    }

    // -----------------------------------------------------------------------
    // Request/response type construction and serialisation
    // -----------------------------------------------------------------------

    mod request_types {
        use super::*;

        #[test]
        fn queue_add_request_serialises_with_game_mode() {
            let req = QueueAddRequest {
                user_id: "user-1".to_string(),
                game_mode: Some("ranked".to_string()),
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("user-1"));
            assert!(json.contains("ranked"));
        }

        #[test]
        fn queue_add_request_serialises_without_game_mode() {
            let req = QueueAddRequest {
                user_id: "user-2".to_string(),
                game_mode: None,
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("user-2"));
        }

        #[test]
        fn queue_remove_request_serialises() {
            let req = QueueRemoveRequest {
                user_id: "user-3".to_string(),
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("user-3"));
        }

        #[test]
        fn snapshot_request_serialises() {
            let req = SnapshotRequest {
                match_id: "match-abc".to_string(),
                tick: 42,
                state_data: serde_json::json!({"regions": {}}),
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("match-abc"));
            assert!(json.contains("42"));
        }

        #[test]
        fn finalize_request_with_winner_serialises() {
            let req = FinalizeRequest {
                match_id: "match-xyz".to_string(),
                winner_id: Some("player-1".to_string()),
                total_ticks: 500,
                final_state: serde_json::json!({}),
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("player-1"));
            assert!(json.contains("500"));
        }

        #[test]
        fn finalize_request_without_winner_serialises() {
            let req = FinalizeRequest {
                match_id: "match-draw".to_string(),
                winner_id: None,
                total_ticks: 300,
                final_state: serde_json::json!({}),
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("match-draw"));
        }

        #[test]
        fn create_chat_message_request_serialises() {
            let req = CreateChatMessageRequest {
                user_id: "user-9".to_string(),
                content: "hello world".to_string(),
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("hello world"));
        }

        #[test]
        fn join_lobby_request_bot_flag_serialises() {
            let req = JoinLobbyRequest {
                lobby_id: "lobby-1".to_string(),
                user_id: "bot-1".to_string(),
                is_bot: true,
            };
            let json = serde_json::to_string(&req).expect("serialise should succeed");
            assert!(json.contains("true"));
        }
    }

    // -----------------------------------------------------------------------
    // Response type deserialisation
    // -----------------------------------------------------------------------

    mod response_types {
        use super::*;

        #[test]
        fn user_info_deserialises_with_defaults() {
            // is_active has default_true, so omitting it should give true.
            let json = r#"{"id":"u1","username":"alice","elo_rating":1200}"#;
            let info: UserInfo = serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(info.id, "u1");
            assert_eq!(info.username, "alice");
            assert_eq!(info.elo_rating, 1200);
            assert!(info.is_active, "is_active should default to true");
        }

        #[test]
        fn user_info_explicit_is_active_false() {
            let json = r#"{"id":"u2","username":"bob","elo_rating":900,"is_active":false}"#;
            let info: UserInfo = serde_json::from_str(json).expect("deserialise should succeed");
            assert!(!info.is_active);
        }

        #[test]
        fn verify_player_result_defaults_is_active_true() {
            let json = r#"{"is_member":true}"#;
            let result: VerifyPlayerResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(result.is_member);
            assert!(result.is_active, "is_active should default to true");
        }

        #[test]
        fn active_match_result_none_when_null() {
            let json = r#"{"match_id":null}"#;
            let result: ActiveMatchResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(result.match_id.is_none());
        }

        #[test]
        fn active_match_result_some_when_present() {
            let json = r#"{"match_id":"match-456"}"#;
            let result: ActiveMatchResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(result.match_id.as_deref(), Some("match-456"));
        }

        #[test]
        fn lobby_state_result_deserialises_full_payload() {
            let json = r#"{
                "lobby_id": "lobby-99",
                "status": "waiting",
                "max_players": 4,
                "game_mode": "ranked",
                "host_user_id": "user-1",
                "players": [
                    {"user_id":"user-1","username":"alice","is_bot":false,"is_ready":false}
                ],
                "full_at": null,
                "created_at": 1234567890.5
            }"#;
            let state: LobbyStateResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(state.lobby_id, "lobby-99");
            assert_eq!(state.status, "waiting");
            assert_eq!(state.max_players, 4);
            assert_eq!(state.players.len(), 1);
            assert!(!state.players[0].is_bot);
            assert!(state.full_at.is_none());
            assert!(state.created_at.is_some());
        }

        #[test]
        fn set_ready_result_all_ready_flag() {
            let json = r#"{
                "all_ready": true,
                "players": [
                    {"user_id":"u1","username":"p1","is_bot":false,"is_ready":true}
                ]
            }"#;
            let result: SetReadyResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(result.all_ready);
            assert_eq!(result.players.len(), 1);
            assert!(result.players[0].is_ready);
        }

        #[test]
        fn leave_lobby_result_cancelled_flag() {
            let json = r#"{"status":"cancelled","cancelled":true}"#;
            let result: LeaveLobbyResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(result.cancelled);
        }

        #[test]
        fn find_or_create_lobby_result_created_false() {
            let json = r#"{
                "lobby_id":"lobby-77",
                "max_players":4,
                "status":"waiting",
                "created":false,
                "players":[],
                "full_at":null
            }"#;
            let result: FindOrCreateLobbyResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(!result.created);
            assert_eq!(result.lobby_id, "lobby-77");
        }

        #[test]
        fn match_player_info_defaults_empty_collections() {
            let json = r#"{
                "user_id":"u1",
                "username":"alice",
                "color":"red"
            }"#;
            let info: MatchPlayerInfo =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(!info.is_bot);
            assert!(info.unlocked_buildings.is_empty());
            assert!(info.unlocked_units.is_empty());
            assert!(info.ability_scrolls.is_empty());
            assert!(info.active_boosts.is_empty());
            assert!(info.ability_levels.is_empty());
            assert!(info.building_levels.is_empty());
            assert!(info.cosmetics.is_empty());
        }

        #[test]
        fn fill_lobby_bots_result_deserialises() {
            let json = r#"{
                "bot_ids":["bot-1","bot-2"],
                "players":[
                    {"user_id":"user-1","username":"alice","is_bot":false,"is_ready":true},
                    {"user_id":"bot-1","username":"Bot1","is_bot":true,"is_ready":true},
                    {"user_id":"bot-2","username":"Bot2","is_bot":true,"is_ready":true}
                ]
            }"#;
            let result: FillLobbyBotsResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(result.bot_ids.len(), 2);
            assert_eq!(result.players.len(), 3);
            assert!(result.players[1].is_bot);
        }

        #[test]
        fn latest_snapshot_response_with_none_fields() {
            let json = r#"{"tick":null,"state_data":null}"#;
            let resp: LatestSnapshotResponse =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert!(resp.tick.is_none());
            assert!(resp.state_data.is_none());
        }

        #[test]
        fn latest_snapshot_response_with_data() {
            let json = r#"{"tick":100,"state_data":{"regions":{}}}"#;
            let resp: LatestSnapshotResponse =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(resp.tick, Some(100));
            assert!(resp.state_data.is_some());
        }

        #[test]
        fn neighbor_map_deserialises() {
            let json = r#"{"neighbors":{"r1":["r2","r3"],"r2":["r1"]}}"#;
            let nm: NeighborMap =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(nm.neighbors["r1"].len(), 2);
            assert_eq!(nm.neighbors["r2"].len(), 1);
        }

        #[test]
        fn queue_count_result_deserialises() {
            let json = r#"{"count":7}"#;
            let result: QueueCountResult =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(result.count, 7);
        }

        #[test]
        fn chat_message_data_deserialises() {
            let json = r#"{
                "user_id":"u1",
                "username":"alice",
                "content":"GG!",
                "timestamp":1700000000.123
            }"#;
            let msg: ChatMessageData =
                serde_json::from_str(json).expect("deserialise should succeed");
            assert_eq!(msg.content, "GG!");
            assert!((msg.timestamp - 1700000000.123).abs() < 0.001);
        }
    }

    // -----------------------------------------------------------------------
    // default_true helper
    // -----------------------------------------------------------------------

    mod default_true_fn {
        use super::*;

        #[test]
        fn default_true_returns_true() {
            assert!(default_true());
        }
    }

    // -----------------------------------------------------------------------
    // HTTP integration tests using wiremock
    //
    // Each test spins up a local mock server, wires a DjangoClient at that
    // address, and asserts correct behaviour for happy-path, error-status, and
    // malformed-body scenarios.
    // -----------------------------------------------------------------------

    mod http_tests {
        use super::*;
        use wiremock::matchers::{header, header_exists, method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        // ------------------------------------------------------------------
        // Helper: build a client pointed at the mock server.
        // ------------------------------------------------------------------

        fn make_client(server: &MockServer) -> DjangoClient {
            DjangoClient::new(server.uri(), "test-secret".to_string())
        }

        // ------------------------------------------------------------------
        // Header injection: X-Internal-Signature must be present on every call.
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_sends_hmac_signature_header() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/users/u1/"))
                .and(header_exists("X-Internal-Signature"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "id": "u1",
                        "username": "alice",
                        "elo_rating": 1500
                    })),
                )
                .expect(1)
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.get_user("u1").await;
            assert!(result.is_ok(), "should succeed when HMAC header is present");
        }

        #[tokio::test]
        async fn post_sends_hmac_signature_header() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/queue/add/"))
                .and(header_exists("X-Internal-Signature"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .expect(1)
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.add_to_queue("user-1", None).await;
            assert!(result.is_ok());
        }

        // ------------------------------------------------------------------
        // get_user
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_user_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/users/u42/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "id": "u42",
                        "username": "bob",
                        "elo_rating": 1300,
                        "is_active": true
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let user = client.get_user("u42").await.expect("should succeed");
            assert_eq!(user.id, "u42");
            assert_eq!(user.username, "bob");
            assert_eq!(user.elo_rating, 1300);
            assert!(user.is_active);
        }

        #[tokio::test]
        async fn get_user_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/users/missing/"))
                .respond_with(ResponseTemplate::new(404).set_body_string("Not found"))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_user("missing").await.unwrap_err();
            match err {
                DjangoError::Status(code, ref p) => {
                    assert_eq!(code, 404);
                    assert!(p.contains("/api/v1/internal/users/missing/"));
                }
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn get_user_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/users/u1/"))
                .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_user("u1").await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn get_user_malformed_json_returns_request_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/users/u1/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_string("this is not json {{{{"),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_user("u1").await.unwrap_err();
            match err {
                DjangoError::Request(_) => {} // correct: reqwest JSON parse error
                other => panic!("expected Request error for malformed JSON, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // verify_player
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn verify_player_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/m1/verify-player/u1/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"is_member": true, "is_active": true})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.verify_player("m1", "u1").await.expect("should succeed");
            assert!(result.is_member);
            assert!(result.is_active);
        }

        #[tokio::test]
        async fn verify_player_403_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/m1/verify-player/u99/"))
                .respond_with(ResponseTemplate::new(403))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.verify_player("m1", "u99").await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 403),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // verify_spectator
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn verify_spectator_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/m1/verify-spectator/u2/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"is_member": true})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .verify_spectator("m1", "u2")
                .await
                .expect("should succeed");
            assert!(result.is_member);
        }

        #[tokio::test]
        async fn verify_spectator_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/no-match/verify-spectator/u2/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .verify_spectator("no-match", "u2")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // get_match_data
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_match_data_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/m1/data/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "max_players": 4,
                        "players": [],
                        "settings_snapshot": {},
                        "is_tutorial": false
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let data = client.get_match_data("m1").await.expect("should succeed");
            assert_eq!(data.max_players, 4);
            assert!(!data.is_tutorial);
        }

        #[tokio::test]
        async fn get_match_data_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/m1/data/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_match_data("m1").await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // get_match_regions
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_match_regions_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matches/m1/regions/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "r1": {
                            "id": "r1",
                            "name": "Silesia",
                            "country_code": "PL",
                            "centroid": [50.0, 18.5],
                            "is_coastal": false,
                            "sea_distances": {}
                        }
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let regions = client
                .get_match_regions("m1")
                .await
                .expect("should succeed");
            assert!(regions.contains_key("r1"));
            assert_eq!(regions["r1"].name, "Silesia");
        }

        // ------------------------------------------------------------------
        // update_match_status (PATCH — previously untested error path)
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn update_match_status_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("PATCH"))
                .and(path("/api/v1/internal/matches/m1/status/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .update_match_status("m1", "in_progress")
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn update_match_status_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("PATCH"))
                .and(path("/api/v1/internal/matches/bad-id/status/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .update_match_status("bad-id", "in_progress")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn update_match_status_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("PATCH"))
                .and(path("/api/v1/internal/matches/m1/status/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .update_match_status("m1", "in_progress")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // set_player_alive
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn set_player_alive_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("PATCH"))
                .and(path("/api/v1/internal/matches/m1/players/u1/alive/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .set_player_alive("m1", "u1", false)
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn set_player_alive_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("PATCH"))
                .and(path("/api/v1/internal/matches/m1/players/no-user/alive/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .set_player_alive("m1", "no-user", true)
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // get_neighbor_map
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_neighbor_map_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/regions/neighbors/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "neighbors": {"r1": ["r2"], "r2": ["r1"]}
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let map = client
                .get_neighbor_map()
                .await
                .expect("should succeed");
            assert_eq!(map["r1"], vec!["r2"]);
        }

        #[tokio::test]
        async fn get_neighbor_map_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/regions/neighbors/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_neighbor_map().await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // try_match
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn try_match_with_game_mode_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/try-match/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "match_id": "m99",
                        "user_ids": ["u1", "u2"],
                        "bot_ids": null
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .try_match(Some("ranked"))
                .await
                .expect("should succeed");
            assert_eq!(result.match_id.as_deref(), Some("m99"));
        }

        #[tokio::test]
        async fn try_match_without_game_mode() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/try-match/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "match_id": null,
                        "user_ids": null
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.try_match(None).await.expect("should succeed");
            assert!(result.match_id.is_none());
        }

        // ------------------------------------------------------------------
        // add_to_queue / remove_from_queue
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn add_to_queue_with_game_mode() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/queue/add/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .add_to_queue("u1", Some("casual"))
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn add_to_queue_500_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/queue/add/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.add_to_queue("u1", None).await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn remove_from_queue_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/queue/remove/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client.remove_from_queue("u1").await.expect("should succeed");
        }

        #[tokio::test]
        async fn remove_from_queue_404_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/queue/remove/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.remove_from_queue("u1").await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // fill_with_bots
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn fill_with_bots_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/matchmaking/fill-with-bots/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "match_id": "m1",
                        "user_ids": ["u1"],
                        "bot_ids": ["bot-1", "bot-2"]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .fill_with_bots(Some("ranked"))
                .await
                .expect("should succeed");
            let bot_ids = result.bot_ids.expect("bot_ids should be Some");
            assert_eq!(bot_ids.len(), 2);
            assert_eq!(bot_ids[0], "bot-1");
            assert_eq!(bot_ids[1], "bot-2");
        }

        // ------------------------------------------------------------------
        // get_queue_count — with and without game_mode query param
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_queue_count_without_game_mode() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matchmaking/queue/count/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"count": 5})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let count = client.get_queue_count(None).await.expect("should succeed");
            assert_eq!(count, 5);
        }

        #[tokio::test]
        async fn get_queue_count_with_game_mode_query_param() {
            let server = MockServer::start().await;
            // The client appends ?game_mode=ranked to the path when a mode is given.
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matchmaking/queue/count/"))
                .and(query_param("game_mode", "ranked"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"count": 3})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let count = client
                .get_queue_count(Some("ranked"))
                .await
                .expect("should succeed");
            assert_eq!(count, 3);
        }

        #[tokio::test]
        async fn get_queue_count_500_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matchmaking/queue/count/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_queue_count(None).await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // get_active_match
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_active_match_returns_none_when_null() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matchmaking/active-match/u1/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"match_id": null})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.get_active_match("u1").await.expect("should succeed");
            assert!(result.is_none());
        }

        #[tokio::test]
        async fn get_active_match_returns_some_when_present() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/matchmaking/active-match/u2/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"match_id": "match-42"})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.get_active_match("u2").await.expect("should succeed");
            assert_eq!(result.as_deref(), Some("match-42"));
        }

        // ------------------------------------------------------------------
        // save_snapshot — including large payload edge case
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn save_snapshot_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/snapshot/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .save_snapshot("m1", 100, serde_json::json!({"regions": {}}))
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn save_snapshot_large_payload() {
            // Build a state_data with many regions to simulate a real match snapshot.
            let mut regions = serde_json::Map::new();
            for i in 0..500 {
                regions.insert(
                    format!("region-{i}"),
                    serde_json::json!({
                        "owner": format!("player-{}", i % 4),
                        "troops": i * 10,
                        "buildings": ["barracks", "watchtower"]
                    }),
                );
            }
            let large_state = serde_json::Value::Object(regions);

            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/snapshot/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .save_snapshot("m1", 9999, large_state)
                .await
                .expect("large payload should succeed");
        }

        #[tokio::test]
        async fn save_snapshot_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/snapshot/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .save_snapshot("m1", 1, serde_json::json!({}))
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // finalize_match — including invalid match ID edge case
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn finalize_match_with_winner_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/finalize/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .finalize_match("m1", Some("u1"), 500, serde_json::json!({}))
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn finalize_match_without_winner() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/finalize/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .finalize_match("m1", None, 300, serde_json::json!({}))
                .await
                .expect("should succeed with no winner");
        }

        #[tokio::test]
        async fn finalize_match_invalid_match_id_returns_404() {
            // Django returns 404 for an unrecognised match ID.
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/finalize/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .finalize_match("does-not-exist", Some("u1"), 1, serde_json::json!({}))
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn finalize_match_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/finalize/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .finalize_match("m1", None, 0, serde_json::json!({}))
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // cleanup_match
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn cleanup_match_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/cleanup/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client.cleanup_match("m1").await.expect("should succeed");
        }

        #[tokio::test]
        async fn cleanup_match_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/game/cleanup/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.cleanup_match("m1").await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // get_latest_snapshot
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_latest_snapshot_with_data() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/latest-snapshot/m1/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "tick": 42,
                        "state_data": {"regions": {}}
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let snap = client
                .get_latest_snapshot("m1")
                .await
                .expect("should succeed");
            assert_eq!(snap.tick, Some(42));
            assert!(snap.state_data.is_some());
        }

        #[tokio::test]
        async fn get_latest_snapshot_empty_returns_none_fields() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/latest-snapshot/m1/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"tick": null, "state_data": null})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let snap = client
                .get_latest_snapshot("m1")
                .await
                .expect("should succeed");
            assert!(snap.tick.is_none());
            assert!(snap.state_data.is_none());
        }

        #[tokio::test]
        async fn get_latest_snapshot_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/latest-snapshot/no-match/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .get_latest_snapshot("no-match")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // list_active_matches
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn list_active_matches_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/active-matches/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "match_ids": ["m1", "m2", "m3"]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let ids = client
                .list_active_matches()
                .await
                .expect("should succeed");
            assert_eq!(ids, vec!["m1", "m2", "m3"]);
        }

        #[tokio::test]
        async fn list_active_matches_empty() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/active-matches/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"match_ids": []})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let ids = client
                .list_active_matches()
                .await
                .expect("should succeed");
            assert!(ids.is_empty());
        }

        // ------------------------------------------------------------------
        // Chat: get_chat_messages / save_chat_message
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_chat_messages_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/chat/messages/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "messages": [
                            {"user_id": "u1", "username": "alice", "content": "gg", "timestamp": 1.0}
                        ]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let msgs = client
                .get_chat_messages(50)
                .await
                .expect("should succeed");
            assert_eq!(msgs.len(), 1);
            assert_eq!(msgs[0].content, "gg");
        }

        #[tokio::test]
        async fn get_chat_messages_500_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/chat/messages/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_chat_messages(10).await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn save_chat_message_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/chat/messages/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "id": "msg-1",
                        "user_id": "u1",
                        "username": "alice",
                        "content": "hello",
                        "timestamp": 1700000000.0
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let resp = client
                .save_chat_message("u1", "hello")
                .await
                .expect("should succeed");
            assert_eq!(resp.content, "hello");
        }

        #[tokio::test]
        async fn save_chat_message_400_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/chat/messages/"))
                .respond_with(ResponseTemplate::new(400))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .save_chat_message("u1", "bad content")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 400),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // Chat: get_match_chat_messages / save_match_chat_message
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_match_chat_messages_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/chat/matches/m1/messages/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "messages": []
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let msgs = client
                .get_match_chat_messages("m1", 20)
                .await
                .expect("should succeed");
            assert!(msgs.is_empty());
        }

        #[tokio::test]
        async fn save_match_chat_message_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/chat/matches/m1/messages/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "id": "msg-2",
                        "user_id": "u1",
                        "username": "alice",
                        "content": "rush!",
                        "timestamp": 1700000001.0
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let resp = client
                .save_match_chat_message("m1", "u1", "rush!")
                .await
                .expect("should succeed");
            assert_eq!(resp.id, "msg-2");
        }

        // ------------------------------------------------------------------
        // Lobby: create_lobby / join_lobby / leave_lobby / set_ready
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn create_lobby_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/create/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "lobby_id": "lobby-1",
                        "max_players": 4,
                        "players": []
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .create_lobby("u1", Some("ranked"))
                .await
                .expect("should succeed");
            assert_eq!(result.lobby_id, "lobby-1");
            assert_eq!(result.max_players, 4);
        }

        #[tokio::test]
        async fn create_lobby_500_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/create/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.create_lobby("u1", None).await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn join_lobby_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/join/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "players": [
                            {"user_id": "u1", "username": "alice", "is_bot": false, "is_ready": false}
                        ],
                        "status": "waiting"
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .join_lobby("lobby-1", "u1", false)
                .await
                .expect("should succeed");
            assert_eq!(result.status, "waiting");
            assert_eq!(result.players.len(), 1);
        }

        #[tokio::test]
        async fn join_lobby_as_bot() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/join/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "players": [
                            {"user_id": "bot-1", "username": "Bot1", "is_bot": true, "is_ready": true}
                        ],
                        "status": "waiting"
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .join_lobby("lobby-1", "bot-1", true)
                .await
                .expect("should succeed");
            assert!(result.players[0].is_bot);
        }

        #[tokio::test]
        async fn join_lobby_404_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/join/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .join_lobby("no-lobby", "u1", false)
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn leave_lobby_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/leave/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "status": "left",
                        "cancelled": false
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .leave_lobby("lobby-1", "u1")
                .await
                .expect("should succeed");
            assert!(!result.cancelled);
        }

        #[tokio::test]
        async fn leave_lobby_cancels_lobby_when_host_leaves() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/leave/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "status": "cancelled",
                        "cancelled": true
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .leave_lobby("lobby-1", "host-u1")
                .await
                .expect("should succeed");
            assert!(result.cancelled);
        }

        #[tokio::test]
        async fn set_ready_all_ready() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/set-ready/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "all_ready": true,
                        "players": [
                            {"user_id": "u1", "username": "alice", "is_bot": false, "is_ready": true}
                        ]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .set_ready("lobby-1", "u1", true)
                .await
                .expect("should succeed");
            assert!(result.all_ready);
        }

        #[tokio::test]
        async fn set_ready_not_all_ready() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/set-ready/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "all_ready": false,
                        "players": [
                            {"user_id": "u1", "username": "alice", "is_bot": false, "is_ready": true},
                            {"user_id": "u2", "username": "bob", "is_bot": false, "is_ready": false}
                        ]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .set_ready("lobby-1", "u1", true)
                .await
                .expect("should succeed");
            assert!(!result.all_ready);
            assert_eq!(result.players.len(), 2);
        }

        // ------------------------------------------------------------------
        // Lobby: fill_lobby_bots / start_match_from_lobby
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn fill_lobby_bots_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/fill-bots/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "bot_ids": ["bot-1"],
                        "players": [
                            {"user_id": "u1", "username": "alice", "is_bot": false, "is_ready": true},
                            {"user_id": "bot-1", "username": "Bot1", "is_bot": true, "is_ready": true}
                        ]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .fill_lobby_bots("lobby-1")
                .await
                .expect("should succeed");
            assert_eq!(result.bot_ids.len(), 1);
            assert_eq!(result.players.len(), 2);
        }

        #[tokio::test]
        async fn start_match_from_lobby_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/start-match/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "match_id": "m-new",
                        "user_ids": ["u1", "u2"]
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .start_match_from_lobby("lobby-1")
                .await
                .expect("should succeed");
            assert_eq!(result.match_id.as_deref(), Some("m-new"));
        }

        #[tokio::test]
        async fn start_match_from_lobby_409_returns_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/start-match/"))
                .respond_with(ResponseTemplate::new(409))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .start_match_from_lobby("lobby-1")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 409),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // notify_lobby_full — infallible: errors are silently discarded
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn notify_lobby_full_does_not_panic_on_success() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/notify-lobby-full/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            // notify_lobby_full returns () — it must not panic even on success.
            client.notify_lobby_full("lobby-1").await;
        }

        #[tokio::test]
        async fn notify_lobby_full_does_not_panic_on_server_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/notify-lobby-full/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            // A 500 error should be swallowed — the method is fire-and-forget.
            client.notify_lobby_full("lobby-1").await;
        }

        // ------------------------------------------------------------------
        // get_lobby / get_active_lobby / find_or_create_lobby
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_lobby_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/lobby/get/lobby-1/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "lobby_id": "lobby-1",
                        "status": "waiting",
                        "max_players": 4,
                        "game_mode": "ranked",
                        "host_user_id": "u1",
                        "players": [],
                        "full_at": null
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let lobby = client.get_lobby("lobby-1").await.expect("should succeed");
            assert_eq!(lobby.lobby_id, "lobby-1");
            assert_eq!(lobby.host_user_id, "u1");
        }

        #[tokio::test]
        async fn get_lobby_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/lobby/get/no-lobby/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_lobby("no-lobby").await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn get_active_lobby_returns_some() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/lobby/active/u1/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"lobby_id": "lobby-42"})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.get_active_lobby("u1").await.expect("should succeed");
            assert_eq!(result.as_deref(), Some("lobby-42"));
        }

        #[tokio::test]
        async fn get_active_lobby_returns_none_when_null() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/lobby/active/u1/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"lobby_id": null})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client.get_active_lobby("u1").await.expect("should succeed");
            assert!(result.is_none());
        }

        #[tokio::test]
        async fn find_or_create_lobby_created_true() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/lobby/find-or-create/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "lobby_id": "lobby-new",
                        "max_players": 4,
                        "status": "waiting",
                        "created": true,
                        "players": [],
                        "full_at": null
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .find_or_create_lobby("u1", Some("ranked"))
                .await
                .expect("should succeed");
            assert!(result.created);
            assert_eq!(result.lobby_id, "lobby-new");
        }

        // ------------------------------------------------------------------
        // find_waiting_lobby — with and without game_mode query param
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn find_waiting_lobby_without_game_mode() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/lobby/find-waiting/"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"lobby_id": "lobby-7"})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .find_waiting_lobby(None)
                .await
                .expect("should succeed");
            assert_eq!(result.as_deref(), Some("lobby-7"));
        }

        #[tokio::test]
        async fn find_waiting_lobby_with_game_mode_query_param() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/lobby/find-waiting/"))
                .and(query_param("game_mode", "casual"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(serde_json::json!({"lobby_id": null})),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let result = client
                .find_waiting_lobby(Some("casual"))
                .await
                .expect("should succeed");
            assert!(result.is_none());
        }

        // ------------------------------------------------------------------
        // Anticheat: report_anticheat_violation / ban_player / compensate_players
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn report_anticheat_violation_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/anticheat/report-violation/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .report_anticheat_violation("m1", "u1", "action_flood", "high", "too many actions", 500)
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn report_anticheat_violation_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/anticheat/report-violation/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .report_anticheat_violation("m1", "u1", "fog_abuse", "medium", "fog-of-war abuse detected", 200)
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn ban_player_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/anticheat/ban-player/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            client
                .ban_player("u1", "confirmed cheat")
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn ban_player_404_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/anticheat/ban-player/"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client
                .ban_player("no-user", "cheating")
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 404),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        #[tokio::test]
        async fn compensate_players_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/anticheat/compensate/"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let player_ids = vec!["u1".to_string(), "u2".to_string()];
            client
                .compensate_players("m1", &player_ids)
                .await
                .expect("should succeed");
        }

        #[tokio::test]
        async fn compensate_players_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .and(path("/api/v1/internal/anticheat/compensate/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let player_ids = vec!["u1".to_string()];
            let err = client
                .compensate_players("m1", &player_ids)
                .await
                .unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // get_system_modules
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn get_system_modules_happy_path() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/system-modules/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "combat": {"enabled": true, "config": {}},
                        "anticheat": {"enabled": false, "config": {"threshold": 10}}
                    })),
                )
                .mount(&server)
                .await;

            let client = make_client(&server);
            let modules = client
                .get_system_modules()
                .await
                .expect("should succeed");
            assert!(modules.contains_key("combat"));
            assert!(modules["combat"].enabled);
            assert!(!modules["anticheat"].enabled);
            assert!(modules["anticheat"].config.contains_key("threshold"));
        }

        #[tokio::test]
        async fn get_system_modules_500_returns_status_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/game/system-modules/"))
                .respond_with(ResponseTemplate::new(500))
                .mount(&server)
                .await;

            let client = make_client(&server);
            let err = client.get_system_modules().await.unwrap_err();
            match err {
                DjangoError::Status(code, _) => assert_eq!(code, 500),
                other => panic!("expected Status error, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // DjangoError display — DjangoError::Request variant
        //
        // We cannot construct a reqwest::Error directly, but we CAN drive the
        // client against a URL that refuses connections to trigger one.
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn request_error_display_contains_django_prefix() {
            // Port 1 is almost certainly not listening — the connect will fail.
            let client = DjangoClient::new(
                "http://127.0.0.1:1".to_string(),
                "secret".to_string(),
            );
            let err = client.get_user("u1").await.unwrap_err();
            match &err {
                DjangoError::Request(_) => {
                    let msg = err.to_string();
                    assert!(
                        msg.starts_with("Django request error:"),
                        "display should start with 'Django request error:' but was: {msg}"
                    );
                }
                other => panic!("expected Request error for refused connection, got: {other}"),
            }
        }

        // ------------------------------------------------------------------
        // base_url trailing-slash trimming — verifies url() produces the
        // correct path after trimming one or more trailing slashes.
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn trailing_slash_trimmed_url_reaches_correct_path() {
            let server = MockServer::start().await;
            // The mock registers the canonical path. If the client double-slashes
            // (e.g. "http://host//api/..."), wiremock will not match and the
            // request expectation will fail at drop.
            Mock::given(method("GET"))
                .and(path("/api/v1/internal/users/u1/"))
                .respond_with(
                    ResponseTemplate::new(200).set_body_json(serde_json::json!({
                        "id": "u1",
                        "username": "carol",
                        "elo_rating": 1100
                    })),
                )
                .expect(1)
                .mount(&server)
                .await;

            // Append a trailing slash to the server URI to exercise trimming.
            let client = DjangoClient::new(
                format!("{}/", server.uri()),
                "test-secret".to_string(),
            );
            let result = client.get_user("u1").await;
            assert!(result.is_ok(), "URL should be constructed correctly after trimming trailing slash");
        }

        // ------------------------------------------------------------------
        // Connection failure: refused connection produces DjangoError::Request
        // ------------------------------------------------------------------

        #[tokio::test]
        async fn connection_refused_returns_request_error() {
            let client = DjangoClient::new(
                "http://127.0.0.1:1".to_string(),
                "secret".to_string(),
            );
            let err = client.get_neighbor_map().await.unwrap_err();
            assert!(
                matches!(err, DjangoError::Request(_)),
                "refused connection should produce DjangoError::Request"
            );
        }

        #[tokio::test]
        async fn connection_refused_on_post_returns_request_error() {
            let client = DjangoClient::new(
                "http://127.0.0.1:1".to_string(),
                "secret".to_string(),
            );
            let err = client.add_to_queue("u1", None).await.unwrap_err();
            assert!(
                matches!(err, DjangoError::Request(_)),
                "refused connection on POST should produce DjangoError::Request"
            );
        }
    }
}
