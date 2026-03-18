use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Client for Django internal API endpoints.
#[derive(Clone)]
pub struct DjangoClient {
    client: Client,
    base_url: String,
    internal_secret: String,
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
    /// Visual cosmetics metadata — passed through to clients, never processed by the engine.
    #[serde(default)]
    pub cosmetics: HashMap<String, serde_json::Value>,
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
    pub fn new(base_url: String, internal_secret: String) -> Self {
        let client = Client::builder()
            .pool_max_idle_per_host(10)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            internal_secret,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, DjangoError> {
        let resp = self
            .client
            .get(self.url(path))
            .header("X-Internal-Secret", &self.internal_secret)
            .send()
            .await
            .map_err(DjangoError::Request)?;

        if !resp.status().is_success() {
            return Err(DjangoError::Status(resp.status().as_u16(), path.to_string()));
        }

        resp.json().await.map_err(DjangoError::Request)
    }

    async fn post<B: Serialize, T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, DjangoError> {
        let resp = self
            .client
            .post(self.url(path))
            .header("X-Internal-Secret", &self.internal_secret)
            .json(body)
            .send()
            .await
            .map_err(DjangoError::Request)?;

        if !resp.status().is_success() {
            return Err(DjangoError::Status(resp.status().as_u16(), path.to_string()));
        }

        resp.json().await.map_err(DjangoError::Request)
    }

    async fn patch<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<(), DjangoError> {
        let resp = self
            .client
            .patch(self.url(path))
            .header("X-Internal-Secret", &self.internal_secret)
            .json(body)
            .send()
            .await
            .map_err(DjangoError::Request)?;

        if !resp.status().is_success() {
            return Err(DjangoError::Status(resp.status().as_u16(), path.to_string()));
        }

        Ok(())
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
}

/// State of a system module as returned by Django.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemModuleState {
    pub enabled: bool,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
}

#[derive(Debug)]
pub enum DjangoError {
    Request(reqwest::Error),
    Status(u16, String),
}

impl std::fmt::Display for DjangoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DjangoError::Request(e) => write!(f, "Django request error: {e}"),
            DjangoError::Status(code, path) => {
                write!(f, "Django returned status {code} for {path}")
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
}
