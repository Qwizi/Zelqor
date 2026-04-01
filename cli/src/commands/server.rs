use anyhow::{bail, Context, Result};
use clap::Subcommand;
use console::style;
use dialoguer::{Confirm, Input, Select};
use std::collections::BTreeMap;
use std::fs;
use std::process::Stdio;

use crate::api::client::{build_authed_client, ApiClient};
use crate::api::models::{CreateAppRequest, CreateServerRequest, UpdateServerRequest};
use crate::config;
use crate::output;

#[derive(clap::Args)]
pub struct ServerArgs {
    #[command(subcommand)]
    pub command: ServerCommand,
}

#[derive(Subcommand)]
pub enum ServerCommand {
    /// Register a new community server and generate zelqor-server.toml
    Create,
    /// List community servers for your app
    List,
    /// Initialize zelqor-server.toml for an existing server
    Init,
    /// Show current server configuration from zelqor-server.toml
    Config,
    /// Sync local zelqor-server.toml with the remote API (push settings + plugins)
    Sync,
    /// Check and install required dependencies (Docker, Compose, Rust, WASM target)
    Install,
    /// Build the gamenode Docker image from source
    Build,
    /// Generate docker-compose.yml and start the server container
    Start,
    /// Stop the server container
    Stop,
    /// Show server status from the API
    Status,
    /// Deregister a community server
    Delete,
}

static REGIONS: &[&str] = &[
    "eu-west",
    "eu-central",
    "us-east",
    "us-west",
    "us-central",
    "ap-southeast",
    "ap-northeast",
    "sa-east",
];

pub async fn run(args: &ServerArgs, api_url_override: &Option<String>) -> Result<()> {
    match &args.command {
        ServerCommand::Create => create_server(api_url_override).await,
        ServerCommand::List => list_servers(api_url_override).await,
        ServerCommand::Init => init_server(api_url_override).await,
        ServerCommand::Config => show_config().await,
        ServerCommand::Sync => sync_server(api_url_override).await,
        ServerCommand::Install => install_dependencies().await,
        ServerCommand::Build => build_gamenode_image().await,
        ServerCommand::Start => start_server(api_url_override).await,
        ServerCommand::Stop => stop_server().await,
        ServerCommand::Status => status_server(api_url_override).await,
        ServerCommand::Delete => delete_server(api_url_override).await,
    }
}

pub async fn list_apps(api_url_override: &Option<String>) -> Result<()> {
    let client = build_authed_client(api_url_override)?;
    let sp = output::spinner("Fetching developer apps...");
    let apps = client.list_apps().await;
    sp.finish_and_clear();

    let apps = apps?;
    output::header(&format!("Developer Apps ({})", apps.len()));
    if apps.is_empty() {
        output::info("No apps found. Create one with `zelqor app create`.");
        return Ok(());
    }
    for app in &apps {
        output::print_kv(&[
            ("ID", app.id.clone()),
            ("Name", app.name.clone()),
            ("Client ID", app.client_id.clone()),
            ("Active", app.is_active.to_string()),
            ("Created", app.created_at.clone()),
        ]);
        println!();
    }
    Ok(())
}

pub async fn create_app(api_url_override: &Option<String>) -> Result<()> {
    output::header("Create Developer App");

    let name: String = Input::new()
        .with_prompt("App name")
        .interact_text()?;

    let description: String = Input::new()
        .with_prompt("Description (optional)")
        .default(String::new())
        .allow_empty(true)
        .interact_text()?;

    let client = build_authed_client(api_url_override)?;
    let sp = output::spinner("Creating app...");
    let result = client.create_app(&CreateAppRequest { name, description }).await;
    sp.finish_and_clear();

    let app = result?;

    output::success("Developer app created!");
    println!();
    output::print_kv(&[
        ("ID", app.id.clone()),
        ("Name", app.name.clone()),
        ("Client ID", app.client_id.clone()),
        ("Client Secret", app.client_secret.clone()),
    ]);
    println!();

    // Persist credentials locally
    let creds = config::AppCredentials {
        app_id: app.id.clone(),
        app_name: app.name.clone(),
        client_id: app.client_id.clone(),
        client_secret: app.client_secret.clone(),
    };
    match config::save_app_credentials(&creds) {
        Ok(()) => output::success("Credentials saved securely."),
        Err(e) => {
            output::warn(&format!("Could not save credentials: {e}"));
            output::warn("Save your client_secret now — it will not be shown again.");
        }
    }

    // Offer to save app_id to config
    let save = Confirm::new()
        .with_prompt("Set this app as your active app in config?")
        .default(true)
        .interact()?;

    if save {
        let mut cfg = config::load()?;
        if let Some(auth) = cfg.auth.as_mut() {
            auth.app_id = Some(app.id.clone());
            config::save(&cfg)?;
            output::success("Active app updated in config.");
        } else {
            output::warn("Not authenticated — run `zelqor login` to save API key first.");
        }
    }

    Ok(())
}

pub fn resolve_app_id(api_url_override: &Option<String>) -> Result<(String, String)> {
    let cfg = config::load()?;
    let base_url = cfg.effective_api_url(api_url_override);
    let auth = cfg
        .auth
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Not authenticated. Run `zelqor login` first."))?;
    let app_id = auth
        .app_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!(
            "No active app set. Run `zelqor app create` or `zelqor login` and select an app."
        ))?;
    Ok((base_url, app_id))
}

async fn create_server(api_url_override: &Option<String>) -> Result<()> {
    output::header("Register Community Server");

    let (base_url, app_id) = resolve_app_id(api_url_override)?;

    let name: String = Input::new()
        .with_prompt("Server name")
        .interact_text()?;

    let description: String = Input::new()
        .with_prompt("Description (optional)")
        .default(String::new())
        .allow_empty(true)
        .interact_text()?;

    let region_idx = Select::new()
        .with_prompt("Region")
        .items(REGIONS)
        .default(0)
        .interact()?;
    let region = REGIONS[region_idx].to_string();

    let max_players_str: String = Input::new()
        .with_prompt("Max players")
        .default("100".to_string())
        .interact_text()?;
    let max_players: u32 = max_players_str.parse().context("Max players must be a number")?;

    let is_public = Confirm::new()
        .with_prompt("Make server public?")
        .default(true)
        .interact()?;

    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let client = ApiClient::new(&base_url, api_key.as_deref());

    let sp = output::spinner("Registering server...");
    let result = client
        .create_server(
            &app_id,
            &CreateServerRequest {
                name: name.clone(),
                description: description.clone(),
                region: region.clone(),
                max_players,
                is_public,
                custom_config: serde_json::Value::Object(serde_json::Map::new()),
            },
        )
        .await;
    sp.finish_and_clear();

    let server = result?;

    output::success("Server registered!");
    output::print_kv(&[
        ("ID", server.id.clone()),
        ("Name", server.name.clone()),
        ("Region", server.region.clone()),
        ("Max Players", server.max_players.to_string()),
        ("Status", server.status.clone()),
        ("Public", server.is_public.to_string()),
    ]);

    // Generate zelqor-server.toml in a per-server directory
    let dir = std::path::PathBuf::from(format!(".zelqor-server-{}", &server.id[..8]));
    fs::create_dir_all(&dir).context("Failed to create server directory")?;

    let mut server_cfg = config::ServerConfig::new(
        &server.id,
        &server.name,
        &server.region,
        server.max_players,
        server.is_public,
    );
    server_cfg.server.description = description;

    config::save_server_config(&dir, &server_cfg)?;

    println!();
    output::success(&format!(
        "Config written to {}/{}",
        dir.display(),
        config::SERVER_CONFIG_FILE
    ));
    output::info("Edit the config file to add plugins and game modes, then run `zelqor server sync`.");

    Ok(())
}

async fn list_servers(api_url_override: &Option<String>) -> Result<()> {
    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let client = ApiClient::new(&base_url, api_key.as_deref());

    let sp = output::spinner("Fetching servers...");
    let servers = client.list_servers(&app_id).await;
    sp.finish_and_clear();

    let servers = servers?;
    output::header(&format!("Community Servers for App {}", &app_id[..8]));
    output::print_table(servers);
    Ok(())
}

async fn status_server(api_url_override: &Option<String>) -> Result<()> {
    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let client = ApiClient::new(&base_url, api_key.as_deref());

    let sp = output::spinner("Fetching server status...");
    let servers = client.list_servers(&app_id).await;
    sp.finish_and_clear();

    let servers = servers?;
    if servers.is_empty() {
        output::info("No servers registered. Run `zelqor server create` first.");
        return Ok(());
    }
    output::header("Server Status");
    for s in &servers {
        let status_colored = match s.status.as_str() {
            "online" => style(&s.status).green().bold().to_string(),
            "offline" => style(&s.status).red().to_string(),
            _ => style(&s.status).yellow().to_string(),
        };
        output::print_kv(&[
            ("ID", s.id[..8].to_string()),
            ("Name", s.name.clone()),
            ("Region", s.region.clone()),
            ("Status", status_colored),
            ("Players", format!("0 / {}", s.max_players)),
        ]);
        println!();
    }
    Ok(())
}

async fn delete_server(api_url_override: &Option<String>) -> Result<()> {
    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let client = ApiClient::new(&base_url, api_key.as_deref());

    let sp = output::spinner("Fetching servers...");
    let servers = client.list_servers(&app_id).await;
    sp.finish_and_clear();

    let servers = servers?;
    if servers.is_empty() {
        output::info("No servers to delete.");
        return Ok(());
    }

    let choices: Vec<String> = servers
        .iter()
        .map(|s| format!("{} - {} ({})", s.name, s.region, s.status))
        .collect();

    let idx = Select::new()
        .with_prompt("Select server to deregister")
        .items(&choices)
        .default(0)
        .interact()?;

    let server = &servers[idx];

    let confirm = Confirm::new()
        .with_prompt(format!(
            "Deregister server '{}' ({})? This cannot be undone.",
            server.name, &server.id[..8]
        ))
        .default(false)
        .interact()?;

    if !confirm {
        output::info("Cancelled.");
        return Ok(());
    }

    let sp = output::spinner("Deregistering server...");
    let result = client.delete_server(&app_id, &server.id).await;
    sp.finish_and_clear();
    result?;

    output::success(&format!("Server '{}' deregistered.", server.name));
    Ok(())
}

async fn start_server(api_url_override: &Option<String>) -> Result<()> {
    output::header("Start Community Server");

    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let client = build_authed_client(api_url_override)?;

    // Find local server directories with zelqor-server.toml
    let server_dirs = config::find_all_server_dirs();

    let dir = if !server_dirs.is_empty() {
        // Pick from local server configs
        let choices: Vec<String> = server_dirs
            .iter()
            .map(|d| {
                match config::load_server_config(d) {
                    Ok(cfg) => format!("{} — {} ({})", cfg.server.name, cfg.server.region, d.display()),
                    Err(_) => d.display().to_string(),
                }
            })
            .collect();

        let idx = Select::new()
            .with_prompt("Select server to start")
            .items(&choices)
            .default(0)
            .interact()?;

        server_dirs[idx].clone()
    } else {
        // No local configs — fall back to fetching from API and selecting
        let sp = output::spinner("Fetching servers...");
        let servers = client.list_servers(&app_id).await?;
        sp.finish_and_clear();

        if servers.is_empty() {
            bail!("No servers registered. Run `zelqor server create` first.");
        }

        let choices: Vec<String> = servers
            .iter()
            .map(|s| format!("{} — {} ({})", s.name, s.region, s.status))
            .collect();

        let idx = Select::new()
            .with_prompt("Select server to start")
            .items(&choices)
            .default(0)
            .interact()?;

        let server = &servers[idx];
        let dir = std::path::PathBuf::from(format!(".zelqor-server-{}", &server.id[..8]));
        fs::create_dir_all(&dir)?;

        // Generate initial config if missing
        if !dir.join(config::SERVER_CONFIG_FILE).exists() {
            let server_cfg = config::ServerConfig::new(
                &server.id, &server.name, &server.region, server.max_players, server.is_public,
            );
            config::save_server_config(&dir, &server_cfg)?;
            output::info(&format!("Generated {} in {}", config::SERVER_CONFIG_FILE, dir.display()));
        }

        dir
    };

    // Load server config
    let server_cfg = config::load_server_config(&dir)?;
    let server_id = &server_cfg.server.id;

    // Sync plugins with the API before starting
    if !server_cfg.plugins.is_empty() {
        output::info("Syncing plugins with the platform...");
        sync_plugins_to_api(&client, &app_id, server_id, &server_cfg).await?;
    }

    // Resolve credentials: saved → prompt fallback
    let (client_id, client_secret) = match config::load_app_credentials(&app_id) {
        Ok(creds) => {
            output::info(&format!("Using saved credentials for app '{}'.", creds.app_name));
            (creds.client_id, creds.client_secret)
        }
        Err(_) => {
            output::warn("No saved credentials found for this app.");
            prompt_credentials()?
        }
    };

    // Generate docker-compose
    let compose_path = dir.join("docker-compose.yml");
    let gateway_url = base_url
        .replace("/api/v1", "")
        .replace("/api", "");

    // Build plugin slugs list for the container env
    let plugin_slugs: Vec<String> = server_cfg
        .plugins
        .iter()
        .filter(|(_, entry)| entry.enabled)
        .map(|(slug, entry)| {
            if entry.version == "latest" {
                slug.clone()
            } else {
                format!("{}@{}", slug, entry.version)
            }
        })
        .collect();

    let compose_content = generate_compose(
        &gateway_url,
        &base_url,
        &client_id,
        &client_secret,
        &server_cfg,
        &plugin_slugs,
    );
    fs::write(&compose_path, &compose_content)
        .context("Failed to write docker-compose.yml")?;

    output::print_kv(&[
        ("Server", server_cfg.server.name.clone()),
        ("Region", server_cfg.server.region.clone()),
        ("Plugins", format!("{} enabled", plugin_slugs.len())),
        ("Game Modes", server_cfg.game_modes.len().to_string()),
        ("Directory", dir.display().to_string()),
    ]);
    println!();

    output::info("Starting server container...");
    let compose = detect_compose().await?;
    output::info(&format!("Using: {}", compose.label()));
    let compose_file = compose_path.to_string_lossy().to_string();
    let status = compose
        .command(&["-f", &compose_file, "up", "-d", "--pull", "always"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("Failed to run docker compose. Run `zelqor server install` to set up dependencies.")?;

    if status.success() {
        output::success(&format!("Server '{}' started.", server_cfg.server.name));
    } else {
        bail!("docker compose up failed with exit code {:?}", status.code());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Init — create zelqor-server.toml for an existing server
// ---------------------------------------------------------------------------

async fn init_server(api_url_override: &Option<String>) -> Result<()> {
    output::header("Initialize Server Config");

    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let client = ApiClient::new(&base_url, api_key.as_deref());

    let sp = output::spinner("Fetching servers...");
    let servers = client.list_servers(&app_id).await?;
    sp.finish_and_clear();

    if servers.is_empty() {
        bail!("No servers found. Run `zelqor server create` first.");
    }

    let choices: Vec<String> = servers
        .iter()
        .map(|s| format!("{} — {} ({})", s.name, s.region, s.status))
        .collect();

    let idx = Select::new()
        .with_prompt("Select server to initialize config for")
        .items(&choices)
        .default(0)
        .interact()?;

    let server = &servers[idx];

    let dir = std::path::PathBuf::from(format!(".zelqor-server-{}", &server.id[..8]));
    fs::create_dir_all(&dir)?;

    let config_path = dir.join(config::SERVER_CONFIG_FILE);
    if config_path.exists() {
        let overwrite = Confirm::new()
            .with_prompt(format!("{} already exists. Overwrite?", config_path.display()))
            .default(false)
            .interact()?;
        if !overwrite {
            output::info("Cancelled.");
            return Ok(());
        }
    }

    // Fetch currently installed plugins from the API
    let sp = output::spinner("Fetching installed plugins...");
    let installed = client.list_server_plugins(&app_id, &server.id).await.unwrap_or_default();
    sp.finish_and_clear();

    let mut plugins = BTreeMap::new();
    for p in &installed {
        plugins.insert(
            p.plugin_slug.clone(),
            config::PluginEntry {
                version: p.plugin_version.clone(),
                enabled: true,
                config: BTreeMap::new(),
            },
        );
    }

    let server_cfg = config::ServerConfig {
        server: config::ServerSettings {
            id: server.id.clone(),
            name: server.name.clone(),
            description: String::new(),
            region: server.region.clone(),
            max_players: server.max_players,
            is_public: server.is_public,
            motd: String::new(),
            max_concurrent_matches: 5,
        },
        plugins,
        game_modes: Vec::new(),
    };

    config::save_server_config(&dir, &server_cfg)?;
    output::success(&format!("Config written to {}", config_path.display()));
    println!();
    output::info("Edit the config to add plugins and game modes:");
    println!();
    println!("  # Add a plugin:");
    println!("  [plugins.speed-boost]");
    println!("  version = \"1.0.0\"");
    println!("  enabled = true");
    println!();
    println!("  # Add a game mode:");
    println!("  [[game_modes]]");
    println!("  name = \"Fast Match\"");
    println!("  slug = \"fast-match\"");
    println!("  max_players = 4");
    println!("  turn_timer_seconds = 15");
    println!();
    output::info("Then run `zelqor server sync` to push changes to the platform.");

    Ok(())
}

// ---------------------------------------------------------------------------
// Config — show current zelqor-server.toml
// ---------------------------------------------------------------------------

async fn show_config() -> Result<()> {
    output::header("Server Configuration");

    let server_dirs = config::find_all_server_dirs();
    if server_dirs.is_empty() {
        bail!(
            "No {} found. Run `zelqor server create` or `zelqor server init` first.",
            config::SERVER_CONFIG_FILE
        );
    }

    let dir = if server_dirs.len() == 1 {
        server_dirs[0].clone()
    } else {
        let choices: Vec<String> = server_dirs
            .iter()
            .map(|d| {
                match config::load_server_config(d) {
                    Ok(cfg) => format!("{} ({})", cfg.server.name, d.display()),
                    Err(_) => d.display().to_string(),
                }
            })
            .collect();
        let idx = Select::new()
            .with_prompt("Select server")
            .items(&choices)
            .default(0)
            .interact()?;
        server_dirs[idx].clone()
    };

    let server_cfg = config::load_server_config(&dir)?;

    output::print_kv(&[
        ("ID", server_cfg.server.id.clone()),
        ("Name", server_cfg.server.name.clone()),
        ("Region", server_cfg.server.region.clone()),
        ("Max Players", server_cfg.server.max_players.to_string()),
        ("Public", server_cfg.server.is_public.to_string()),
        ("MOTD", if server_cfg.server.motd.is_empty() { "(none)".into() } else { server_cfg.server.motd.clone() }),
        ("Max Matches", server_cfg.server.max_concurrent_matches.to_string()),
    ]);

    if !server_cfg.plugins.is_empty() {
        println!();
        output::header(&format!("Plugins ({})", server_cfg.plugins.len()));
        for (slug, entry) in &server_cfg.plugins {
            let status = if entry.enabled {
                style("enabled").green().to_string()
            } else {
                style("disabled").red().to_string()
            };
            println!("  {} v{} [{}]", style(slug).bold(), entry.version, status);
            if !entry.config.is_empty() {
                for (k, v) in &entry.config {
                    println!("    {} = {}", k, v);
                }
            }
        }
    }

    if !server_cfg.game_modes.is_empty() {
        println!();
        output::header(&format!("Game Modes ({})", server_cfg.game_modes.len()));
        for gm in &server_cfg.game_modes {
            output::print_kv(&[
                ("Name", gm.name.clone()),
                ("Slug", gm.slug.clone()),
                ("Max Players", gm.max_players.to_string()),
                ("Turn Timer", format!("{}s", gm.turn_timer_seconds)),
            ]);
            println!();
        }
    }

    println!();
    output::info(&format!("Config file: {}/{}", dir.display(), config::SERVER_CONFIG_FILE));

    Ok(())
}

// ---------------------------------------------------------------------------
// Sync — push local config to API
// ---------------------------------------------------------------------------

async fn sync_server(api_url_override: &Option<String>) -> Result<()> {
    output::header("Sync Server Config");

    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let client = ApiClient::new(&base_url, api_key.as_deref());

    let server_dirs = config::find_all_server_dirs();
    if server_dirs.is_empty() {
        bail!(
            "No {} found. Run `zelqor server create` or `zelqor server init` first.",
            config::SERVER_CONFIG_FILE
        );
    }

    let dir = if server_dirs.len() == 1 {
        server_dirs[0].clone()
    } else {
        let choices: Vec<String> = server_dirs
            .iter()
            .map(|d| {
                match config::load_server_config(d) {
                    Ok(cfg) => format!("{} ({})", cfg.server.name, d.display()),
                    Err(_) => d.display().to_string(),
                }
            })
            .collect();
        let idx = Select::new()
            .with_prompt("Select server to sync")
            .items(&choices)
            .default(0)
            .interact()?;
        server_dirs[idx].clone()
    };

    let server_cfg = config::load_server_config(&dir)?;
    let server_id = &server_cfg.server.id;

    // 1. Sync server settings
    let sp = output::spinner("Syncing server settings...");
    let update_req = UpdateServerRequest {
        name: Some(server_cfg.server.name.clone()),
        description: Some(server_cfg.server.description.clone()),
        region: Some(server_cfg.server.region.clone()),
        max_players: Some(server_cfg.server.max_players),
        is_public: Some(server_cfg.server.is_public),
        motd: if server_cfg.server.motd.is_empty() { None } else { Some(server_cfg.server.motd.clone()) },
        custom_config: None,
    };
    client.update_server(&app_id, server_id, &update_req).await?;
    sp.finish_and_clear();
    output::success("Server settings synced.");

    // 2. Sync plugins
    if !server_cfg.plugins.is_empty() {
        sync_plugins_to_api(&client, &app_id, server_id, &server_cfg).await?;
    }

    output::success("Sync complete.");
    Ok(())
}

/// Sync the local plugin list with the remote API.
/// Installs missing plugins, uninstalls removed ones.
async fn sync_plugins_to_api(
    client: &ApiClient,
    app_id: &str,
    server_id: &str,
    server_cfg: &config::ServerConfig,
) -> Result<()> {
    // Fetch currently installed plugins from the API
    let remote_plugins = client
        .list_server_plugins(app_id, server_id)
        .await
        .unwrap_or_default();

    let remote_slugs: std::collections::HashSet<String> = remote_plugins
        .iter()
        .map(|p| p.plugin_slug.clone())
        .collect();

    let local_slugs: std::collections::HashSet<String> = server_cfg
        .plugins
        .keys()
        .cloned()
        .collect();

    // Install plugins that are in local config but not remote
    for (slug, entry) in &server_cfg.plugins {
        if !remote_slugs.contains(slug) {
            let version = if entry.version == "latest" { None } else { Some(entry.version.as_str()) };
            let sp = output::spinner(&format!("Installing plugin '{slug}'..."));
            match client.install_server_plugin(app_id, server_id, slug, version).await {
                Ok(p) => {
                    sp.finish_and_clear();
                    output::success(&format!("  Installed {} v{}", p.plugin_name, p.plugin_version));
                }
                Err(e) => {
                    sp.finish_and_clear();
                    output::warn(&format!("  Failed to install '{}': {}", slug, e));
                }
            }
        }
    }

    // Uninstall plugins that are remote but not in local config
    for slug in &remote_slugs {
        if !local_slugs.contains(slug) {
            let sp = output::spinner(&format!("Uninstalling plugin '{slug}'..."));
            match client.uninstall_server_plugin(app_id, server_id, slug).await {
                Ok(()) => {
                    sp.finish_and_clear();
                    output::success(&format!("  Uninstalled '{}'", slug));
                }
                Err(e) => {
                    sp.finish_and_clear();
                    output::warn(&format!("  Failed to uninstall '{}': {}", slug, e));
                }
            }
        }
    }

    Ok(())
}

async fn stop_server() -> Result<()> {
    output::header("Stop Community Server");

    // Find running server directories
    let dirs: Vec<_> = fs::read_dir(".")
        .context("Cannot read current directory")?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with(".zelqor-server-")
                && e.path().join("docker-compose.yml").exists()
        })
        .collect();

    if dirs.is_empty() {
        output::warn("No server directories found. Nothing to stop.");
        return Ok(());
    }

    let choices: Vec<String> = dirs
        .iter()
        .map(|d| d.file_name().to_string_lossy().to_string())
        .chain(std::iter::once("All".to_string()))
        .collect();

    let idx = Select::new()
        .with_prompt("Select server to stop")
        .items(&choices)
        .default(0)
        .interact()?;

    let targets: Vec<_> = if idx == dirs.len() {
        dirs.iter().collect()
    } else {
        vec![&dirs[idx]]
    };

    let compose_cmd = detect_compose().await?;
    output::info(&format!("Using: {}", compose_cmd.label()));

    for dir in targets {
        let compose_file = dir.path().join("docker-compose.yml");
        let compose_str = compose_file.to_string_lossy().to_string();
        output::info(&format!("Stopping {}...", dir.file_name().to_string_lossy()));
        let status = compose_cmd
            .command(&["-f", &compose_str, "down"])
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .context("Failed to run docker compose")?;

        if status.success() {
            output::success("Stopped.");
        } else {
            output::warn(&format!(
                "docker compose down failed for {}",
                dir.file_name().to_string_lossy()
            ));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Compose command detection (handles old `docker-compose` vs new `docker compose`)
// ---------------------------------------------------------------------------

/// Detected Docker Compose invocation method.
enum ComposeCmd {
    /// `docker compose` (v2 plugin — preferred)
    Plugin,
    /// `docker-compose` (standalone v1/v2 binary)
    Standalone,
}

impl ComposeCmd {
    /// Build a tokio Command for a compose operation (e.g. "up -d", "down").
    fn command(&self, compose_args: &[&str]) -> tokio::process::Command {
        match self {
            ComposeCmd::Plugin => {
                let mut cmd = tokio::process::Command::new("docker");
                cmd.arg("compose");
                cmd.args(compose_args);
                cmd
            }
            ComposeCmd::Standalone => {
                let mut cmd = tokio::process::Command::new("docker-compose");
                cmd.args(compose_args);
                cmd
            }
        }
    }

    fn label(&self) -> &'static str {
        match self {
            ComposeCmd::Plugin => "docker compose (v2 plugin)",
            ComposeCmd::Standalone => "docker-compose (standalone)",
        }
    }
}

/// Detect the available Docker Compose invocation. Prefers `docker compose` (plugin).
async fn detect_compose() -> Result<ComposeCmd> {
    // Try v2 plugin first: `docker compose version`
    let plugin = tokio::process::Command::new("docker")
        .args(["compose", "version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;

    if let Ok(s) = plugin {
        if s.success() {
            return Ok(ComposeCmd::Plugin);
        }
    }

    // Fallback: standalone `docker-compose`
    if which::which("docker-compose").is_ok() {
        output::warn("Using legacy docker-compose. Consider upgrading to Docker Compose v2 plugin.");
        return Ok(ComposeCmd::Standalone);
    }

    bail!(
        "Docker Compose not found.\n\
         Install it with: `zelqor server install` or visit https://docs.docker.com/compose/install/"
    );
}

// ---------------------------------------------------------------------------
// Install dependencies
// ---------------------------------------------------------------------------

/// Detect the OS package manager.
fn detect_pkg_manager() -> Option<&'static str> {
    for pm in &["apt-get", "dnf", "yum", "pacman", "apk", "zypper", "brew"] {
        if which::which(pm).is_ok() {
            return Some(pm);
        }
    }
    None
}

/// Detect OS family for install instructions.
fn detect_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

async fn install_dependencies() -> Result<()> {
    output::header("Install Server Dependencies");
    println!();

    let os = detect_os();
    let pkg = detect_pkg_manager();

    // Track what needs installing
    let has_docker = which::which("docker").is_ok();
    let has_compose = detect_compose().await.is_ok();
    let has_rust = which::which("rustc").is_ok();
    let has_cargo = which::which("cargo").is_ok();

    let has_wasm_target = if has_rust {
        check_wasm_target().await
    } else {
        false
    };

    // Report current state
    print_dep_status("Docker", has_docker);
    print_dep_status("Docker Compose", has_compose);
    print_dep_status("Rust", has_rust && has_cargo);
    print_dep_status("wasm32-wasip1 target", has_wasm_target);
    println!();

    if has_docker && has_compose && has_rust && has_cargo && has_wasm_target {
        output::success("All dependencies already installed!");
        return Ok(());
    }

    // Install Docker
    if !has_docker {
        output::info("Installing Docker...");
        let installed = match (os, pkg) {
            ("macos", _) => {
                output::info("On macOS, install Docker Desktop from https://docker.com/products/docker-desktop/");
                output::info("Or via Homebrew:");
                println!("  brew install --cask docker");
                if pkg == Some("brew") {
                    let proceed = Confirm::new()
                        .with_prompt("Install Docker Desktop via Homebrew?")
                        .default(true)
                        .interact()?;
                    if proceed {
                        run_install_cmd("brew", &["install", "--cask", "docker"]).await?
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            ("linux", Some("apt-get")) => {
                output::info("Installing Docker via official convenience script...");
                let proceed = Confirm::new()
                    .with_prompt("Run Docker install script? (curl -fsSL https://get.docker.com | sh)")
                    .default(true)
                    .interact()?;
                if proceed {
                    run_piped_install("https://get.docker.com").await?
                } else {
                    false
                }
            }
            ("linux", Some("dnf")) => {
                let proceed = Confirm::new()
                    .with_prompt("Install Docker via dnf?")
                    .default(true)
                    .interact()?;
                if proceed {
                    run_install_cmd("sudo", &["dnf", "install", "-y", "docker-ce", "docker-ce-cli", "containerd.io", "docker-compose-plugin"]).await?
                } else {
                    false
                }
            }
            ("linux", Some("pacman")) => {
                let proceed = Confirm::new()
                    .with_prompt("Install Docker via pacman?")
                    .default(true)
                    .interact()?;
                if proceed {
                    run_install_cmd("sudo", &["pacman", "-S", "--noconfirm", "docker", "docker-compose"]).await?
                } else {
                    false
                }
            }
            ("linux", _) => {
                output::info("Install Docker: curl -fsSL https://get.docker.com | sh");
                let proceed = Confirm::new()
                    .with_prompt("Run Docker install script?")
                    .default(true)
                    .interact()?;
                if proceed {
                    run_piped_install("https://get.docker.com").await?
                } else {
                    false
                }
            }
            _ => {
                output::warn("Visit https://docs.docker.com/get-docker/ to install Docker for your OS.");
                false
            }
        };

        if installed {
            output::success("Docker installed.");
            // Add user to docker group on Linux
            if os == "linux" {
                let _ = tokio::process::Command::new("sudo")
                    .args(["usermod", "-aG", "docker", &whoami()])
                    .status()
                    .await;
                output::info("Added current user to docker group. You may need to log out and back in.");
            }
        } else {
            output::warn("Docker not installed — install it manually and re-run.");
        }
    }

    // Install Docker Compose (if Docker is present but compose isn't)
    if !has_compose && (has_docker || which::which("docker").is_ok()) {
        output::info("Installing Docker Compose plugin...");
        let installed = match (os, pkg) {
            ("macos", _) => {
                output::info("Docker Compose is included with Docker Desktop on macOS.");
                false
            }
            ("linux", Some("apt-get")) => {
                let proceed = Confirm::new()
                    .with_prompt("Install docker-compose-plugin via apt?")
                    .default(true)
                    .interact()?;
                if proceed {
                    run_install_cmd("sudo", &["apt-get", "install", "-y", "docker-compose-plugin"]).await?
                } else {
                    false
                }
            }
            ("linux", Some("dnf")) => {
                let proceed = Confirm::new()
                    .with_prompt("Install docker-compose-plugin via dnf?")
                    .default(true)
                    .interact()?;
                if proceed {
                    run_install_cmd("sudo", &["dnf", "install", "-y", "docker-compose-plugin"]).await?
                } else {
                    false
                }
            }
            _ => {
                output::info("Install Docker Compose: https://docs.docker.com/compose/install/");
                false
            }
        };

        if installed {
            output::success("Docker Compose installed.");
        }
    }

    // Install Rust
    if !has_rust || !has_cargo {
        output::info("Installing Rust via rustup...");
        let proceed = Confirm::new()
            .with_prompt("Install Rust via rustup.rs?")
            .default(true)
            .interact()?;

        if proceed {
            let installed = run_piped_install_with_args(
                "https://sh.rustup.rs",
                &["-y", "--default-toolchain", "stable"],
            )
            .await?;
            if installed {
                output::success("Rust installed. Restart your shell or run: source $HOME/.cargo/env");
            }
        }
    }

    // Install wasm32-wasip1 target
    if (has_rust || which::which("rustup").is_ok()) && !has_wasm_target {
        output::info("Adding wasm32-wasip1 target...");
        let status = tokio::process::Command::new("rustup")
            .args(["target", "add", "wasm32-wasip1"])
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await;
        match status {
            Ok(s) if s.success() => output::success("wasm32-wasip1 target added."),
            _ => output::warn("Failed to add wasm32-wasip1 target. Run: rustup target add wasm32-wasip1"),
        }
    }

    println!();
    output::info("Re-checking dependencies...");
    println!();

    // Final status check
    let final_docker = which::which("docker").is_ok();
    let final_compose = detect_compose().await.is_ok();
    let final_rust = which::which("rustc").is_ok();
    let final_wasm = if final_rust { check_wasm_target().await } else { false };

    print_dep_status("Docker", final_docker);
    print_dep_status("Docker Compose", final_compose);
    print_dep_status("Rust", final_rust);
    print_dep_status("wasm32-wasip1 target", final_wasm);
    println!();

    if final_docker && final_compose && final_rust && final_wasm {
        output::success("All dependencies installed! Run `zelqor server start` to launch your server.");
    } else {
        output::warn("Some dependencies are missing. Install them manually and re-run `zelqor server install`.");
    }

    Ok(())
}

fn print_dep_status(name: &str, ok: bool) {
    if ok {
        println!("  {} {}", style("✓").green().bold(), name);
    } else {
        println!("  {} {}", style("✗").red().bold(), name);
    }
}

async fn check_wasm_target() -> bool {
    let output = tokio::process::Command::new("rustup")
        .args(["target", "list", "--installed"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;
    match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).contains("wasm32-wasip1"),
        Err(_) => false,
    }
}

fn whoami() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_else(|_| "nobody".into())
}

/// Run a command and return whether it succeeded.
async fn run_install_cmd(cmd: &str, args: &[&str]) -> Result<bool> {
    let status = tokio::process::Command::new(cmd)
        .args(args)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context(format!("Failed to run {cmd}"))?;
    Ok(status.success())
}

/// Download a script and pipe it to sh.
async fn run_piped_install(url: &str) -> Result<bool> {
    run_piped_install_with_args(url, &[]).await
}

/// Download a script and pipe it to sh with extra args.
async fn run_piped_install_with_args(url: &str, args: &[&str]) -> Result<bool> {
    let mut curl = tokio::process::Command::new("curl")
        .args(["-fsSL", url])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("curl not found — install curl first")?;

    let curl_stdout_async = curl
        .stdout
        .take()
        .expect("piped stdout");

    // Convert tokio ChildStdout → std::process::Stdio.
    // Unix exposes into_owned_fd(), Windows exposes into_owned_handle().
    #[cfg(unix)]
    let curl_stdout: Stdio = {
        let fd = curl_stdout_async.into_owned_fd().context("Failed to get stdout fd")?;
        Stdio::from(fd)
    };
    #[cfg(windows)]
    let curl_stdout: Stdio = {
        let handle = curl_stdout_async.into_owned_handle().context("Failed to get stdout handle")?;
        Stdio::from(handle)
    };

    let mut sh_args = vec!["-s", "--"];
    sh_args.extend_from_slice(args);

    let status = tokio::process::Command::new("sh")
        .args(&sh_args)
        .stdin(curl_stdout)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("Failed to run install script")?;

    Ok(status.success())
}

const GAMENODE_IMAGE: &str = "ghcr.io/qwizi/zelqor-gamenode:latest";

async fn build_gamenode_image() -> Result<()> {
    output::header("Build Gamenode Docker Image");

    let gateway_dir = find_gateway_dir()?;

    output::info(&format!("Building from {}", gateway_dir.display()));
    output::info(&format!("Image: {}", GAMENODE_IMAGE));

    let status = tokio::process::Command::new("docker")
        .args([
            "build",
            "-t",
            GAMENODE_IMAGE,
            "-f",
            &gateway_dir.join("Dockerfile.gamenode").to_string_lossy(),
            &gateway_dir.to_string_lossy(),
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("Failed to run docker build. Is Docker installed?")?;

    if !status.success() {
        bail!("Docker build failed.");
    }

    output::success(&format!("Image '{}' built.", GAMENODE_IMAGE));

    let push = Confirm::new()
        .with_prompt("Push image to GHCR?")
        .default(false)
        .interact()?;

    if push {
        output::info("Pushing to GHCR...");
        let status = tokio::process::Command::new("docker")
            .args(["push", GAMENODE_IMAGE])
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .context("Failed to push image")?;

        if status.success() {
            output::success("Image pushed to GHCR.");
        } else {
            output::warn("Push failed. Run `docker login ghcr.io` first.");
        }
    }

    Ok(())
}

/// Find the gateway source directory by walking up from CWD.
fn find_gateway_dir() -> Result<std::path::PathBuf> {
    let candidates = [
        std::path::PathBuf::from("gateway"),
        std::path::PathBuf::from("../gateway"),
        std::path::PathBuf::from("../../gateway"),
    ];
    for candidate in &candidates {
        if candidate.join("Dockerfile.gamenode").exists() {
            return Ok(candidate.clone());
        }
    }
    bail!(
        "Could not find gateway/Dockerfile.gamenode. Run from the Zelqor project root, \
         or clone the repo: git clone https://github.com/qwizi/zelqor.git"
    );
}

fn prompt_credentials() -> Result<(String, String)> {
    output::info("Provide your Developer App credentials for the gamenode.");
    let client_id: String = Input::new()
        .with_prompt("Client ID (from `zelqor app list`)")
        .interact_text()?;
    let client_secret: String = Input::new()
        .with_prompt("Client Secret")
        .interact_text()?;
    Ok((client_id, client_secret))
}

fn generate_compose(
    gateway_url: &str,
    oauth_url: &str,
    client_id: &str,
    client_secret: &str,
    server_cfg: &config::ServerConfig,
    plugin_slugs: &[String],
) -> String {
    let plugins_env = if plugin_slugs.is_empty() {
        String::new()
    } else {
        format!(
            "      PLUGINS: \"{}\"\n",
            plugin_slugs.join(",")
        )
    };

    let motd_env = if server_cfg.server.motd.is_empty() {
        String::new()
    } else {
        format!("      SERVER_MOTD: \"{}\"\n", server_cfg.server.motd.replace('"', "\\\""))
    };

    format!(
        r#"services:
  zelqor-gamenode:
    image: {image}
    restart: unless-stopped
    environment:
      GATEWAY_URL: "{gateway_url}"
      OAUTH_URL: "{oauth_url}"
      CLIENT_ID: "{client_id}"
      CLIENT_SECRET: "{client_secret}"
      REDIS_URL: "redis://redis:6379/1"
      RUST_LOG: "info,zelqor_gamenode=debug"
      PLUGINS_DIR: "/data/plugins_cache"
      MAX_CONCURRENT_MATCHES: "{max_matches}"
      SERVER_NAME: "{server_name}"
{plugins_env}{motd_env}    volumes:
      - plugins_cache:/data/plugins_cache
    depends_on:
      - redis
  redis:
    image: redis:7-alpine
    restart: unless-stopped
volumes:
  plugins_cache:
"#,
        image = GAMENODE_IMAGE,
        max_matches = server_cfg.server.max_concurrent_matches,
        server_name = server_cfg.server.name.replace('"', "\\\""),
    )
}
