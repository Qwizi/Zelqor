use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const DEFAULT_API_URL: &str = "http://localhost:8000/api/v1";
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct CliConfig {
    pub api_url: Option<String>,
    pub auth: Option<AuthConfig>,
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
