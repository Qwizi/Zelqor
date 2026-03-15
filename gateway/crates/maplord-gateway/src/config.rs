/// Application configuration loaded from environment variables.
#[derive(Clone)]
pub struct AppConfig {
    pub secret_key: String,
    pub redis_host: String,
    pub redis_port: u16,
    pub redis_game_db: u8,
    pub django_internal_url: String,
    pub internal_secret: String,
    pub gateway_port: u16,
    pub livekit_url: String,
    pub livekit_public_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    /// Allowed WebSocket origins — shares CORS_ALLOWED_ORIGINS with Django.
    /// Empty = allow all (dev mode).
    pub allowed_ws_origins: Vec<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            secret_key: std::env::var("SECRET_KEY")
                .unwrap_or_else(|_| "django-insecure-dev-key-change-in-production".into()),
            redis_host: std::env::var("REDIS_HOST").unwrap_or_else(|_| "redis".into()),
            redis_port: std::env::var("REDIS_PORT")
                .unwrap_or_else(|_| "6379".into())
                .parse()
                .unwrap_or(6379),
            redis_game_db: std::env::var("REDIS_GAME_DB")
                .unwrap_or_else(|_| "1".into())
                .parse()
                .unwrap_or(1),
            django_internal_url: std::env::var("DJANGO_INTERNAL_URL")
                .unwrap_or_else(|_| "http://backend:8000".into()),
            internal_secret: std::env::var("INTERNAL_SECRET")
                .unwrap_or_else(|_| "dev-internal-secret".into()),
            gateway_port: std::env::var("GATEWAY_PORT")
                .unwrap_or_else(|_| "8080".into())
                .parse()
                .unwrap_or(8080),
            livekit_url: std::env::var("LIVEKIT_URL")
                .unwrap_or_else(|_| "ws://livekit:7880".into()),
            livekit_public_url: std::env::var("LIVEKIT_PUBLIC_URL")
                .unwrap_or_else(|_| "ws://localhost:7880".into()),
            livekit_api_key: std::env::var("LIVEKIT_API_KEY")
                .unwrap_or_else(|_| "devkey".into()),
            livekit_api_secret: std::env::var("LIVEKIT_API_SECRET")
                .unwrap_or_else(|_| "secret".into()),
            allowed_ws_origins: std::env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
        }
    }

    pub fn redis_url(&self) -> String {
        format!(
            "redis://{}:{}/{}",
            self.redis_host, self.redis_port, self.redis_game_db
        )
    }
}
