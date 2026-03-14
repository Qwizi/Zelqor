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
    ) -> Result<bool, DjangoError> {
        let result: VerifyPlayerResult = self
            .get(&format!(
                "/api/v1/internal/matches/{match_id}/verify-player/{user_id}/"
            ))
            .await?;
        Ok(result.is_member)
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
