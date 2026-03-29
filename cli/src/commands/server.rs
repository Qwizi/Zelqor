use anyhow::{bail, Context, Result};
use clap::Subcommand;
use console::style;
use dialoguer::{Confirm, Input, Select};
use std::fs;
use std::process::Stdio;

use crate::api::client::{build_authed_client, ApiClient};
use crate::api::models::{CreateAppRequest, CreateServerRequest};
use crate::config;
use crate::output;

#[derive(clap::Args)]
pub struct ServerArgs {
    #[command(subcommand)]
    pub command: ServerCommand,
}

#[derive(Subcommand)]
pub enum ServerCommand {
    /// Register a new community server
    Create,
    /// List community servers for your app
    List,
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

fn resolve_app_id(api_url_override: &Option<String>) -> Result<(String, String)> {
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
                name,
                description,
                region,
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

    // Fetch registered servers
    let sp = output::spinner("Fetching servers...");
    let servers = client.list_servers(&app_id).await;
    sp.finish_and_clear();
    let servers = servers?;

    if servers.is_empty() {
        output::warn("No servers registered. Run `zelqor server create` first.");
        return Ok(());
    }

    // Let user pick which server to start
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

    // Generate docker-compose in a per-server directory
    let dir = std::path::PathBuf::from(format!(".zelqor-server-{}", &server.id[..8]));
    fs::create_dir_all(&dir).context("Failed to create server directory")?;

    let compose_path = dir.join("docker-compose.yml");
    let gateway_url = base_url
        .replace("/api/v1", "")
        .replace("/api", "");
    let compose_content = generate_compose(&gateway_url, &client_id, &client_secret);
    fs::write(&compose_path, &compose_content)
        .context("Failed to write docker-compose.yml")?;

    output::print_kv(&[
        ("Server", server.name.clone()),
        ("Region", server.region.clone()),
        ("Directory", dir.display().to_string()),
    ]);
    println!();

    output::info("Starting server container...");
    let status = tokio::process::Command::new("docker")
        .args(["compose", "-f", &compose_path.to_string_lossy(), "up", "-d"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("Failed to run docker compose. Is Docker installed?")?;

    if status.success() {
        output::success(&format!("Server '{}' started.", server.name));
    } else {
        bail!("docker compose up failed with exit code {:?}", status.code());
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

    for dir in targets {
        let compose = dir.path().join("docker-compose.yml");
        output::info(&format!("Stopping {}...", dir.file_name().to_string_lossy()));
        let status = tokio::process::Command::new("docker")
            .args(["compose", "-f", &compose.to_string_lossy(), "down"])
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

const GAMENODE_IMAGE: &str = "ghcr.io/qwizi/zelqor-gateway:latest";

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
            &gateway_dir.join("Dockerfile").to_string_lossy(),
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
        if candidate.join("Dockerfile").exists() {
            return Ok(candidate.clone());
        }
    }
    bail!(
        "Could not find gateway/Dockerfile. Run from the Zelqor project root, \
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

fn generate_compose(gateway_url: &str, client_id: &str, client_secret: &str) -> String {
    format!(
        r#"services:
  zelqor-gamenode:
    image: {image}
    command: zelqor-gamenode
    restart: unless-stopped
    environment:
      GATEWAY_URL: "{gateway_url}"
      CLIENT_ID: "{client_id}"
      CLIENT_SECRET: "{client_secret}"
      REDIS_URL: "redis://redis:6379/1"
      RUST_LOG: "info,zelqor_gamenode=debug"
    depends_on:
      - redis
  redis:
    image: redis:7-alpine
    restart: unless-stopped
"#,
        image = GAMENODE_IMAGE,
    )
}
