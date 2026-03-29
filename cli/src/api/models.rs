use serde::{Deserialize, Serialize};

// === Developer App ===

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DeveloperApp {
    pub id: String,
    pub name: String,
    pub description: String,
    pub client_id: String,
    pub is_active: bool,
    pub created_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct DeveloperAppCreated {
    pub id: String,
    pub name: String,
    pub description: String,
    pub client_id: String,
    pub client_secret: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CreateAppRequest {
    pub name: String,
    pub description: String,
}

// === API Keys ===

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ApiKey {
    pub id: String,
    pub prefix: String,
    pub scopes: Vec<String>,
    pub rate_limit: u32,
    pub is_active: bool,
    pub last_used: Option<String>,
    pub created_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct ApiKeyCreated {
    pub id: String,
    pub prefix: String,
    pub scopes: Vec<String>,
    pub rate_limit: u32,
    pub is_active: bool,
    pub last_used: Option<String>,
    pub created_at: String,
    pub key: String,
}

#[derive(Debug, Serialize)]
pub struct CreateApiKeyRequest {
    pub scopes: Vec<String>,
    pub rate_limit: u32,
}

// === Community Servers ===

#[derive(Debug, Deserialize, Serialize, Clone, tabled::Tabled)]
pub struct ServerResponse {
    pub id: String,
    pub name: String,
    pub region: String,
    pub status: String,
    pub max_players: u32,
    #[tabled(display_with = "display_bool")]
    pub is_public: bool,
    #[tabled(display_with = "display_bool")]
    pub is_verified: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: String,
    pub region: String,
    pub max_players: u32,
    pub is_public: bool,
    pub custom_config: serde_json::Value,
}

// === Plugins ===

#[derive(Debug, Deserialize, Serialize, Clone, tabled::Tabled)]
pub struct PluginResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub version: String,
    pub description: String,
    #[tabled(display_with = "display_bool")]
    pub is_published: bool,
    #[tabled(display_with = "display_bool")]
    pub is_approved: bool,
    pub download_count: u64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CreatePluginRequest {
    pub name: String,
    pub slug: String,
    pub description: String,
    pub hooks: Vec<String>,
}

// === User / OAuth userinfo ===

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub email: String,
    pub elo_rating: i64,
    pub avatar: Option<String>,
    pub date_joined: String,
}

// === OAuth Token Response ===

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    #[allow(dead_code)]
    pub token_type: Option<String>,
    #[allow(dead_code)]
    pub expires_in: Option<u64>,
}

// === Paginated wrapper ===

#[derive(Debug, Deserialize)]
pub struct Paginated<T> {
    pub items: Vec<T>,
    #[allow(dead_code)]
    pub count: u64,
}

// === Helpers for tabled display ===

pub fn display_bool(b: &bool) -> String {
    if *b { "yes".to_string() } else { "no".to_string() }
}
