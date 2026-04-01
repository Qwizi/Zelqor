use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const DEFAULT_API_URL: &str = "https://zelqor.qwizi.ovh/api/v1";

/// Server configuration file name — lives in the server directory.
pub const SERVER_CONFIG_FILE: &str = "zelqor-server.toml";

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct CliConfig {
    pub api_url: Option<String>,
    pub auth: Option<AuthConfig>,
}

// ---------------------------------------------------------------------------
// zelqor-server.toml — local config for a community server
// ---------------------------------------------------------------------------

/// Top-level structure of `zelqor-server.toml`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerConfig {
    pub server: ServerSettings,
    #[serde(default)]
    pub plugins: BTreeMap<String, PluginEntry>,
    #[serde(default)]
    pub game_modes: Vec<GameModeEntry>,
}

/// `[server]` section — basic server settings synced with the API.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerSettings {
    /// Remote server ID (assigned by the API on create).
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub region: String,
    #[serde(default = "default_max_players")]
    pub max_players: u32,
    #[serde(default = "default_true")]
    pub is_public: bool,
    #[serde(default)]
    pub motd: String,
    #[serde(default = "default_max_matches")]
    pub max_concurrent_matches: u32,
}

/// `[plugins.<slug>]` — a WASM plugin installed on the server.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginEntry {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Plugin-specific configuration (free-form TOML → JSON).
    #[serde(default)]
    pub config: BTreeMap<String, toml::Value>,
}

/// `[[game_modes]]` — a custom game mode definition.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameModeEntry {
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_max_players_mode")]
    pub max_players: u32,
    #[serde(default = "default_turn_timer")]
    pub turn_timer_seconds: u32,
    #[serde(default)]
    pub config: BTreeMap<String, toml::Value>,
}

fn default_max_players() -> u32 { 100 }
fn default_max_matches() -> u32 { 5 }
fn default_max_players_mode() -> u32 { 8 }
fn default_turn_timer() -> u32 { 30 }
fn default_version() -> String { "latest".into() }
fn default_true() -> bool { true }

impl ServerConfig {
    /// Generate an example config with sensible defaults.
    pub fn new(server_id: &str, name: &str, region: &str, max_players: u32, is_public: bool) -> Self {
        Self {
            server: ServerSettings {
                id: server_id.to_string(),
                name: name.to_string(),
                description: String::new(),
                region: region.to_string(),
                max_players,
                is_public,
                motd: String::new(),
                max_concurrent_matches: 5,
            },
            plugins: BTreeMap::new(),
            game_modes: Vec::new(),
        }
    }
}

/// Load a `zelqor-server.toml` from the given directory.
pub fn load_server_config(dir: &Path) -> Result<ServerConfig> {
    let path = dir.join(SERVER_CONFIG_FILE);
    let contents = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let cfg: ServerConfig = toml::from_str(&contents)
        .with_context(|| format!("Failed to parse {}", path.display()))?;
    Ok(cfg)
}

/// Save a `zelqor-server.toml` to the given directory.
pub fn save_server_config(dir: &Path, cfg: &ServerConfig) -> Result<()> {
    let path = dir.join(SERVER_CONFIG_FILE);
    let contents = toml::to_string_pretty(cfg).context("Failed to serialize server config")?;
    std::fs::write(&path, contents)
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

/// Find a server directory in the current working directory by server ID prefix.
pub fn find_server_dir(server_id_prefix: &str) -> Option<PathBuf> {
    let pattern = format!(".zelqor-server-{}", server_id_prefix);
    std::fs::read_dir(".")
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with(&pattern) && e.path().join(SERVER_CONFIG_FILE).exists()
        })
        .map(|e| e.path())
}

/// Find ALL server directories in the current working directory.
pub fn find_all_server_dirs() -> Vec<PathBuf> {
    std::fs::read_dir(".")
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with(".zelqor-server-")
                && e.path().join(SERVER_CONFIG_FILE).exists()
        })
        .map(|e| e.path())
        .collect()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthConfig {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub app_id: Option<String>,
}

impl CliConfig {
    pub fn effective_api_url(&self, override_url: &Option<String>) -> String {
        override_url
            .clone()
            .or_else(|| self.api_url.clone())
            .unwrap_or_else(|| DEFAULT_API_URL.to_string())
    }

}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppCredentials {
    pub app_id: String,
    pub app_name: String,
    pub client_id: String,
    pub client_secret: String,
}

pub fn apps_dir() -> Result<std::path::PathBuf> {
    let dir = dirs::config_dir()
        .context("Could not determine config directory")?
        .join("zelqor")
        .join("apps");
    Ok(dir)
}

pub fn save_app_credentials(creds: &AppCredentials) -> Result<()> {
    let dir = apps_dir()?;
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create apps dir {}", dir.display()))?;
    let path = dir.join(format!("{}.toml", &creds.app_id));
    let contents = toml::to_string_pretty(creds).context("Failed to serialize app credentials")?;
    std::fs::write(&path, contents)
        .with_context(|| format!("Failed to write credentials to {}", path.display()))?;
    Ok(())
}

pub fn load_app_credentials(app_id: &str) -> Result<AppCredentials> {
    let path = apps_dir()?.join(format!("{app_id}.toml"));
    let contents = std::fs::read_to_string(&path)
        .with_context(|| format!("No saved credentials for app {app_id}"))?;
    let creds: AppCredentials = toml::from_str(&contents)
        .with_context(|| format!("Failed to parse credentials from {}", path.display()))?;
    Ok(creds)
}

pub fn config_path() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .context("Could not determine config directory")?
        .join("zelqor");
    Ok(dir.join("config.toml"))
}

pub fn load() -> Result<CliConfig> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(CliConfig::default());
    }
    let contents = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read config from {}", path.display()))?;
    let config: CliConfig = toml::from_str(&contents)
        .with_context(|| format!("Failed to parse config from {}", path.display()))?;
    Ok(config)
}

pub fn save(config: &CliConfig) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create config dir {}", parent.display()))?;
    }
    let contents = toml::to_string_pretty(config).context("Failed to serialize config")?;
    std::fs::write(&path, contents)
        .with_context(|| format!("Failed to write config to {}", path.display()))?;
    Ok(())
}
