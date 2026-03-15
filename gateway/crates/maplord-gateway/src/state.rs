use crate::chat::ChatConnections;
use crate::config::AppConfig;
use crate::game::GameConnections;
use dashmap::DashMap;
use maplord_django::DjangoClient;
use maplord_matchmaking::MatchmakingManager;
use std::sync::Arc;
use std::time::Instant;

/// Shared application state available to all handlers.
#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub redis: redis::aio::ConnectionManager,
    pub django: DjangoClient,
    pub matchmaking: Arc<MatchmakingManager>,
    pub game_connections: GameConnections,
    /// Global chat WebSocket senders: user_id -> Vec<sender>
    pub chat_connections: ChatConnections,
    /// Cached usernames from Django: user_id -> (username, fetched_at)
    pub username_cache: Arc<DashMap<String, (String, Instant)>>,
    /// Last message timestamp per user for chat rate limiting
    pub chat_rate_limits: Arc<DashMap<String, Instant>>,
    /// Action count + window start per user for game action rate limiting
    pub action_rate_limits: Arc<DashMap<String, (u32, Instant)>>,
}
