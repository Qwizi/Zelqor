use anyhow::{bail, Context, Result};
use clap::Subcommand;
use console::style;
use dialoguer::{Confirm, Input, MultiSelect, Select};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;

use crate::api::client::{build_authed_client, ApiClient};
use crate::api::models::CreatePluginRequest;
use crate::commands::server::resolve_app_id;
use crate::config;
use crate::output;

#[derive(clap::Args)]
pub struct PluginArgs {
    #[command(subcommand)]
    pub command: PluginCommand,
}

#[derive(Subcommand)]
pub enum PluginCommand {
    /// Scaffold a new WASM plugin project
    Create,
    /// Build the WASM plugin (cargo build --target wasm32-wasip1 --release)
    Build,
    /// List your plugins (or public plugins with --public)
    List {
        /// Show public/approved plugins instead of your own
        #[arg(long)]
        public: bool,
    },
    /// Register plugin metadata with the platform
    Publish,
    /// Install a plugin on a server
    Install {
        /// Plugin slug to install
        slug: String,
        /// Specific version (default: latest)
        #[arg(long)]
        version: Option<String>,
    },
    /// Uninstall a plugin from a server
    Uninstall {
        /// Plugin slug to uninstall
        slug: String,
    },
    /// Search public plugins
    Search {
        /// Search query
        query: String,
        /// Filter by category
        #[arg(long)]
        category: Option<String>,
    },
    /// Show plugin details
    Info {
        /// Plugin slug
        slug: String,
    },
    /// Initialize a zelqor-plugins.lock from zelqor-plugin.toml
    Lock,
    /// Upload WASM blob to the platform
    Upload,
}

static AVAILABLE_HOOKS: &[&str] = &[
    "on_tick",
    "on_player_action",
    "on_combat_resolve",
    "on_match_start",
    "on_match_end",
    "on_player_join",
    "on_player_leave",
    "on_player_eliminate",
    "on_economy_tick",
    "on_energy_spend",
    "on_unit_produce",
    "on_unit_move",
    "on_building_construct",
    "on_building_upgrade",
    "on_building_destroy",
    "on_region_capture",
    "on_region_lose",
    "on_diplomacy_propose",
    "on_diplomacy_accept",
    "on_diplomacy_reject",
    "on_capital_select",
    "on_ability_use",
    "on_nuke_launch",
    "on_bomber_launch",
    "on_weather_change",
    "on_day_night_change",
    "on_chat_message",
    "on_vote_start",
    "on_vote_end",
    "on_config_reload",
];

pub async fn run(args: &PluginArgs, api_url_override: &Option<String>) -> Result<()> {
    match &args.command {
        PluginCommand::Create => create_plugin_scaffold(api_url_override).await,
        PluginCommand::Build => build_plugin().await,
        PluginCommand::List { public } => list_plugins(api_url_override, *public).await,
        PluginCommand::Publish => publish_plugin(api_url_override).await,
        PluginCommand::Install { slug, version } => {
            install_plugin(api_url_override, slug, version).await
        }
        PluginCommand::Uninstall { slug } => uninstall_plugin(api_url_override, slug).await,
        PluginCommand::Search { query, category } => {
            search_plugins(api_url_override, query, category).await
        }
        PluginCommand::Info { slug } => plugin_info(api_url_override, slug).await,
        PluginCommand::Lock => lock_plugins().await,
        PluginCommand::Upload => upload_plugin(api_url_override).await,
    }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

async fn install_plugin(
    api_url_override: &Option<String>,
    slug: &str,
    version: &Option<String>,
) -> Result<()> {
    output::header("Install Plugin");

    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let client = build_authed_client(api_url_override)?;

    let sp = output::spinner("Fetching servers...");
    let servers = client.list_servers(&app_id).await?;
    sp.finish_and_clear();

    if servers.is_empty() {
        bail!("No servers found. Create one with `zelqor server create` first.");
    }

    let choices: Vec<String> = servers
        .iter()
        .map(|s| format!("{} — {} ({})", s.name, s.region, s.status))
        .collect();
    let idx = Select::new()
        .with_prompt("Select server")
        .items(&choices)
        .default(0)
        .interact()?;
    let server = &servers[idx];

    let sp = output::spinner(&format!("Installing plugin '{slug}'..."));
    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let authed = ApiClient::new(&base_url, api_key.as_deref());
    let result = authed
        .install_server_plugin(&app_id, &server.id, slug, version.as_deref())
        .await;
    sp.finish_and_clear();

    match result {
        Ok(installed) => {
            output::success(&format!(
                "Plugin '{}' installed on '{}'",
                slug, server.name
            ));
            output::print_kv(&[
                ("Plugin", installed.plugin_name),
                ("Version", installed.plugin_version),
                ("Server", server.name.clone()),
            ]);
        }
        Err(e) => bail!("Failed to install plugin: {e}"),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

async fn uninstall_plugin(api_url_override: &Option<String>, slug: &str) -> Result<()> {
    output::header("Uninstall Plugin");

    let (base_url, app_id) = resolve_app_id(api_url_override)?;
    let client = build_authed_client(api_url_override)?;

    let sp = output::spinner("Fetching servers...");
    let servers = client.list_servers(&app_id).await?;
    sp.finish_and_clear();

    if servers.is_empty() {
        bail!("No servers found. Create one with `zelqor server create` first.");
    }

    let choices: Vec<String> = servers
        .iter()
        .map(|s| format!("{} — {} ({})", s.name, s.region, s.status))
        .collect();
    let idx = Select::new()
        .with_prompt("Select server")
        .items(&choices)
        .default(0)
        .interact()?;
    let server = &servers[idx];

    let confirm = Confirm::new()
        .with_prompt(format!(
            "Uninstall plugin '{}' from '{}'?",
            slug, server.name
        ))
        .default(false)
        .interact()?;

    if !confirm {
        output::info("Cancelled.");
        return Ok(());
    }

    let cfg = config::load()?;
    let api_key = cfg.auth.as_ref().map(|a| a.access_token.as_str().to_string());
    let authed = ApiClient::new(&base_url, api_key.as_deref());

    let sp = output::spinner(&format!("Uninstalling plugin '{slug}'..."));
    let result = authed
        .uninstall_server_plugin(&app_id, &server.id, slug)
        .await;
    sp.finish_and_clear();

    match result {
        Ok(()) => output::success(&format!(
            "Plugin '{}' uninstalled from '{}'.",
            slug, server.name
        )),
        Err(e) => bail!("Failed to uninstall plugin: {e}"),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async fn search_plugins(
    api_url_override: &Option<String>,
    query: &str,
    category: &Option<String>,
) -> Result<()> {
    let cfg = config::load()?;
    let base_url = cfg.effective_api_url(api_url_override);
    let client = ApiClient::new(&base_url, None);

    let sp = output::spinner(&format!("Searching for '{query}'..."));
    let plugins = client.search_plugins(query, category.as_deref()).await?;
    sp.finish_and_clear();

    output::header(&format!(
        "Search Results for '{}' ({})",
        query,
        plugins.len()
    ));
    if plugins.is_empty() {
        output::info("No plugins found matching your query.");
        return Ok(());
    }
    output::print_table(plugins);
    Ok(())
}

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

async fn plugin_info(api_url_override: &Option<String>, slug: &str) -> Result<()> {
    let cfg = config::load()?;
    let base_url = cfg.effective_api_url(api_url_override);
    let client = ApiClient::new(&base_url, None);

    let sp = output::spinner("Fetching plugin details...");
    let plugin = client.get_plugin(slug).await?;
    sp.finish_and_clear();

    output::header(&format!("{} v{}", plugin.name, plugin.version));
    output::print_kv(&[
        ("Slug", plugin.slug),
        ("Category", plugin.category),
        ("Author", plugin.author_name),
        ("License", plugin.license),
        ("Downloads", plugin.download_count.to_string()),
        ("Installs", plugin.install_count.to_string()),
        (
            "Rating",
            format!(
                "{:.1}/5 ({} reviews)",
                plugin.average_rating, plugin.rating_count
            ),
        ),
        ("Hooks", plugin.hooks.join(", ")),
        ("Tags", plugin.tags.join(", ")),
    ]);
    if !plugin.description.is_empty() {
        println!();
        println!("{}", plugin.description);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

async fn lock_plugins() -> Result<()> {
    output::header("Lock Plugin Dependencies");

    let manifest_path = "zelqor-plugin.toml";
    if !std::path::Path::new(manifest_path).exists() {
        bail!("zelqor-plugin.toml not found. Are you in a plugin directory?");
    }

    let manifest_str = fs::read_to_string(manifest_path)?;
    let manifest: toml::Value = toml::from_str(&manifest_str)?;

    // Extract [dependencies] table
    let deps = manifest
        .get("dependencies")
        .and_then(|d| d.as_table())
        .cloned()
        .unwrap_or_default();

    if deps.is_empty() {
        output::info("No [dependencies] found in zelqor-plugin.toml — nothing to lock.");
        return Ok(());
    }

    output::info(&format!("Resolving {} dependencies...", deps.len()));

    // Build lock entries. We resolve the version constraint against the
    // platform catalogue when possible; for now we record the declared
    // constraint and a placeholder resolved version so the file is parseable.
    let mut lock_entries: Vec<String> = Vec::new();
    for (name, constraint) in &deps {
        let constraint_str = constraint.as_str().unwrap_or("*");
        // Strip leading comparison operators to get a bare version string.
        let resolved = constraint_str
            .trim_start_matches(">=")
            .trim_start_matches("<=")
            .trim_start_matches('>')
            .trim_start_matches('<')
            .trim_start_matches('~')
            .trim_start_matches('^')
            .trim()
            .to_string();
        output::info(&format!("  {name} {constraint_str} -> {resolved}"));
        lock_entries.push(format!(
            "[[plugin]]\nname = \"{name}\"\nversion = \"{resolved}\"\nconstraint = \"{constraint_str}\"\n"
        ));
    }

    let lock_content = format!(
        "# zelqor-plugins.lock — generated by `zelqor plugin lock`\n# Do not edit manually.\n\n{}\n",
        lock_entries.join("\n")
    );
    fs::write("zelqor-plugins.lock", &lock_content)
        .context("Failed to write zelqor-plugins.lock")?;

    output::success("zelqor-plugins.lock written.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async fn upload_plugin(api_url_override: &Option<String>) -> Result<()> {
    output::header("Upload WASM Plugin");

    let manifest_path = "zelqor-plugin.toml";
    if !std::path::Path::new(manifest_path).exists() {
        bail!("zelqor-plugin.toml not found. Are you in a plugin directory?");
    }

    let manifest_str = fs::read_to_string(manifest_path)?;
    let manifest: toml::Value = toml::from_str(&manifest_str)?;
    let slug = manifest["slug"].as_str().unwrap_or("").to_string();

    // Locate the .wasm output
    let wasm_files = glob_wasm_outputs()?;
    if wasm_files.is_empty() {
        bail!(
            "No .wasm file found in target/wasm32-wasip1/release/. \
             Run `zelqor plugin build` first."
        );
    }

    // Use the first .wasm that matches the crate slug, or fall back to the
    // first file found.
    let wasm_path = wasm_files
        .iter()
        .find(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s == slug || s == slug.replace('-', "_"))
                .unwrap_or(false)
        })
        .unwrap_or(&wasm_files[0]);

    let hash = sha256_file(wasm_path)?;
    let size = fs::metadata(wasm_path)?.len();

    output::print_kv(&[
        ("File", wasm_path.display().to_string()),
        ("Size", format!("{} KB", size / 1024)),
        ("SHA-256", hash.clone()),
    ]);
    println!();

    let confirm = Confirm::new()
        .with_prompt("Upload this WASM blob to the platform?")
        .default(true)
        .interact()?;

    if !confirm {
        output::info("Upload cancelled.");
        return Ok(());
    }

    // TODO: ApiClient::upload_plugin_wasm() — multipart upload endpoint not
    // yet implemented on the backend. For now we print the hash so developers
    // can verify the correct artifact before the endpoint lands.
    output::warn(
        "WASM upload endpoint is not yet available on the platform. \
         Share the SHA-256 hash above with the Zelqor team to manually register your build.",
    );
    let _ = api_url_override; // suppress unused warning until endpoint exists
    Ok(())
}

// ---------------------------------------------------------------------------
// Create scaffold
// ---------------------------------------------------------------------------

async fn create_plugin_scaffold(api_url_override: &Option<String>) -> Result<()> {
    output::header("Create Zelqor WASM Plugin");

    let name: String = Input::new()
        .with_prompt("Plugin name (e.g. my-plugin)")
        .interact_text()?;

    let slug: String = Input::new()
        .with_prompt("Slug (lowercase-hyphen, e.g. my-plugin)")
        .default(name.to_lowercase().replace(' ', "-"))
        .interact_text()?;

    let description: String = Input::new()
        .with_prompt("Description")
        .default(String::new())
        .allow_empty(true)
        .interact_text()?;

    let hook_selections = MultiSelect::new()
        .with_prompt("Select hooks to implement (space to toggle, enter to confirm)")
        .items(AVAILABLE_HOOKS)
        .interact()?;

    let hooks: Vec<String> = hook_selections
        .into_iter()
        .map(|i| AVAILABLE_HOOKS[i].to_string())
        .collect();

    // Scaffold directory
    let dir = PathBuf::from(&slug);
    if dir.exists() {
        bail!("Directory '{}' already exists.", slug);
    }
    let src_dir = dir.join("src");
    fs::create_dir_all(&src_dir).context("Failed to create plugin directory")?;

    // Cargo.toml
    let cargo_toml = generate_plugin_cargo_toml(&name, &slug);
    fs::write(dir.join("Cargo.toml"), cargo_toml)?;

    // src/lib.rs
    let lib_rs = generate_plugin_lib_rs(&hooks);
    fs::write(src_dir.join("lib.rs"), lib_rs)?;

    // .cargo/config.toml for wasm target
    let cargo_config_dir = dir.join(".cargo");
    fs::create_dir_all(&cargo_config_dir)?;
    fs::write(
        cargo_config_dir.join("config.toml"),
        "[build]\ntarget = \"wasm32-wasip1\"\n",
    )?;

    // zelqor-plugin.toml manifest
    let manifest = generate_plugin_manifest(&name, &slug, &description, &hooks);
    fs::write(dir.join("zelqor-plugin.toml"), manifest)?;

    // README
    fs::write(
        dir.join("README.md"),
        format!(
            "# {name}\n\n{description}\n\n## Building\n\n```bash\nzelqor plugin build\n```\n"
        ),
    )?;

    output::success(&format!("Plugin scaffolded at ./{slug}"));
    println!();
    println!("  Next steps:");
    println!("    {} cd {}", style("1.").cyan(), slug);
    println!("    {} Edit {}", style("2.").cyan(), style("src/lib.rs").bold());
    println!(
        "    {} Run {}",
        style("3.").cyan(),
        style("zelqor plugin build").bold()
    );
    println!(
        "    {} Run {}",
        style("4.").cyan(),
        style("zelqor plugin publish").bold()
    );

    // Optionally register with platform now
    let register = Confirm::new()
        .with_prompt("Register this plugin with the platform now?")
        .default(false)
        .interact()?;

    if register {
        register_plugin_with_platform(api_url_override, &name, &slug, &description, &hooks)
            .await?;
    }

    Ok(())
}

async fn register_plugin_with_platform(
    api_url_override: &Option<String>,
    name: &str,
    slug: &str,
    description: &str,
    hooks: &[String],
) -> Result<()> {
    let cfg = config::load()?;
    let auth = cfg
        .auth
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Not authenticated. Run `zelqor login` first."))?;
    let app_id = auth
        .app_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!("No active app. Run `zelqor app create` first."))?;
    let base_url = cfg.effective_api_url(api_url_override);
    let client = ApiClient::new(&base_url, Some(&auth.access_token));

    let sp = output::spinner("Registering plugin...");
    let result = client
        .create_plugin(
            &app_id,
            &CreatePluginRequest {
                name: name.to_string(),
                slug: slug.to_string(),
                description: description.to_string(),
                hooks: hooks.to_vec(),
            },
        )
        .await;
    sp.finish_and_clear();

    match result {
        Ok(plugin) => {
            output::success(&format!(
                "Plugin '{}' registered (ID: {})",
                plugin.name,
                &plugin.id[..8]
            ));
        }
        Err(e) => {
            output::warn(&format!("Could not register plugin: {}", e));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async fn build_plugin() -> Result<()> {
    output::header("Build WASM Plugin");

    // Check for zelqor-plugin.toml
    if !std::path::Path::new("zelqor-plugin.toml").exists() {
        bail!("zelqor-plugin.toml not found. Are you in a plugin directory?");
    }

    // Ensure wasm32-wasip1 target is installed
    let sp = output::spinner("Checking wasm32-wasip1 target...");
    let target_check = tokio::process::Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output()
        .await
        .context("Failed to run rustup")?;
    sp.finish_and_clear();

    let installed = String::from_utf8_lossy(&target_check.stdout);
    if !installed.contains("wasm32-wasip1") {
        output::warn("wasm32-wasip1 target not installed. Installing...");
        let status = tokio::process::Command::new("rustup")
            .args(["target", "add", "wasm32-wasip1"])
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .context("Failed to run rustup target add")?;
        if !status.success() {
            bail!("Failed to install wasm32-wasip1 target");
        }
    }

    let sp = output::spinner("Compiling WASM plugin (release)...");
    let status = tokio::process::Command::new("cargo")
        .args(["build", "--target", "wasm32-wasip1", "--release"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .status()
        .await
        .context("Failed to run cargo build")?;
    sp.finish_and_clear();

    if !status.success() {
        bail!("cargo build failed. Run `cargo build --target wasm32-wasip1 --release` for details.");
    }

    // Find the .wasm output
    let wasm_files: Vec<_> = glob_wasm_outputs()?;
    if wasm_files.is_empty() {
        bail!("No .wasm output files found in target/wasm32-wasip1/release/");
    }

    for wasm_path in &wasm_files {
        let hash = sha256_file(wasm_path)?;
        let size = fs::metadata(wasm_path)?.len();
        output::success(&format!(
            "Built: {} ({} KB)",
            wasm_path.display(),
            size / 1024
        ));
        output::print_kv(&[("SHA-256", hash)]);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async fn list_plugins(api_url_override: &Option<String>, public: bool) -> Result<()> {
    let cfg = config::load()?;
    let base_url = cfg.effective_api_url(api_url_override);

    if public {
        let client = ApiClient::new(&base_url, None);
        let sp = output::spinner("Fetching public plugins...");
        let plugins = client.list_public_plugins().await;
        sp.finish_and_clear();

        let plugins = plugins?;
        output::header(&format!("Public Plugins ({})", plugins.len()));
        output::print_table(plugins);
    } else {
        let auth = cfg
            .auth
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Not authenticated. Run `zelqor login` first."))?;
        let app_id = auth
            .app_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("No active app. Run `zelqor app create` first."))?;
        let client = ApiClient::new(&base_url, Some(&auth.access_token));

        let sp = output::spinner("Fetching plugins...");
        let plugins = client.list_plugins(&app_id).await;
        sp.finish_and_clear();

        let plugins = plugins?;
        output::header(&format!("Your Plugins ({})", plugins.len()));
        output::print_table(plugins);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

async fn publish_plugin(api_url_override: &Option<String>) -> Result<()> {
    output::header("Publish Plugin");

    // Read manifest
    let manifest_path = "zelqor-plugin.toml";
    if !std::path::Path::new(manifest_path).exists() {
        bail!("zelqor-plugin.toml not found. Are you in a plugin directory?");
    }

    let manifest_str = fs::read_to_string(manifest_path)?;
    let manifest: toml::Value = toml::from_str(&manifest_str)?;

    let name = manifest["name"].as_str().unwrap_or("").to_string();
    let slug = manifest["slug"].as_str().unwrap_or("").to_string();
    let description = manifest
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let hooks: Vec<String> = manifest
        .get("hooks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // Show summary
    output::print_kv(&[
        ("Name", name.clone()),
        ("Slug", slug.clone()),
        ("Description", description.clone()),
        ("Hooks", hooks.join(", ")),
    ]);
    println!();

    let confirm = Confirm::new()
        .with_prompt("Publish this plugin to the platform?")
        .default(true)
        .interact()?;

    if !confirm {
        output::info("Publish cancelled.");
        return Ok(());
    }

    register_plugin_with_platform(api_url_override, &name, &slug, &description, &hooks).await?;
    output::info("Your plugin is pending review before appearing in the public listing.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn glob_wasm_outputs() -> Result<Vec<PathBuf>> {
    let base = PathBuf::from("target/wasm32-wasip1/release");
    if !base.exists() {
        return Ok(vec![]);
    }
    let mut results = vec![];
    for entry in fs::read_dir(&base).context("Failed to read target dir")? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "wasm").unwrap_or(false) {
            results.push(path);
        }
    }
    Ok(results)
}

fn sha256_file(path: &PathBuf) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn generate_plugin_cargo_toml(name: &str, slug: &str) -> String {
    format!(
        r#"[package]
name = "{slug}"
version = "0.1.0"
edition = "2021"
description = "{name} — Zelqor WASM plugin"

[lib]
crate-type = ["cdylib"]

[dependencies]
# Add your dependencies here
"#
    )
}

fn generate_plugin_lib_rs(hooks: &[String]) -> String {
    let mut code = String::from(
        r#"//! Zelqor WASM Plugin
//! Generated by `zelqor plugin create`

// ============================================================
// Hook implementations
// Each hook is exported as a C ABI function that the Zelqor
// gateway calls at the appropriate point in game logic.
// ============================================================

"#,
    );

    for hook in hooks {
        let fn_body = match hook.as_str() {
            "on_tick" => "    // Called every game tick. Implement tick-level logic here.\n    0",
            "on_player_action" => "    // Called when a player performs an action.\n    0",
            "on_combat_resolve" => "    // Called when combat is being resolved.\n    0",
            "on_match_start" => "    // Called when a match begins.\n    0",
            "on_match_end" => "    // Called when a match ends.\n    0",
            "on_player_join" => "    // Called when a player joins the match.\n    0",
            "on_player_leave" => "    // Called when a player leaves the match.\n    0",
            "on_player_eliminate" => "    // Called when a player is eliminated.\n    0",
            "on_economy_tick" => "    // Called on each economy tick.\n    0",
            "on_energy_spend" => "    // Called when a player spends energy.\n    0",
            "on_unit_produce" => "    // Called when a unit is produced.\n    0",
            "on_unit_move" => "    // Called when a unit moves.\n    0",
            "on_building_construct" => "    // Called when a building is constructed.\n    0",
            "on_building_upgrade" => "    // Called when a building is upgraded.\n    0",
            "on_building_destroy" => "    // Called when a building is destroyed.\n    0",
            "on_region_capture" => "    // Called when a region is captured.\n    0",
            "on_region_lose" => "    // Called when a region is lost.\n    0",
            "on_diplomacy_propose" => "    // Called when a diplomacy proposal is made.\n    0",
            "on_diplomacy_accept" => "    // Called when a diplomacy proposal is accepted.\n    0",
            "on_diplomacy_reject" => "    // Called when a diplomacy proposal is rejected.\n    0",
            "on_capital_select" => "    // Called when a player selects a capital.\n    0",
            "on_ability_use" => "    // Called when a player uses an ability.\n    0",
            "on_nuke_launch" => "    // Called when a nuke is launched.\n    0",
            "on_bomber_launch" => "    // Called when a bomber is launched.\n    0",
            "on_weather_change" => "    // Called when weather changes.\n    0",
            "on_day_night_change" => "    // Called on day/night cycle transition.\n    0",
            "on_chat_message" => "    // Called when a chat message is sent.\n    0",
            "on_vote_start" => "    // Called when a vote is started.\n    0",
            "on_vote_end" => "    // Called when a vote ends.\n    0",
            "on_config_reload" => "    // Called when server config is reloaded.\n    0",
            _ => "    0",
        };
        code.push_str(&format!(
            r#"/// Hook: {hook}
#[no_mangle]
pub extern "C" fn {hook}(ctx_ptr: u32, ctx_len: u32) -> i32 {{
{fn_body}
}}

"#
        ));
    }

    code
}

fn generate_plugin_manifest(name: &str, slug: &str, description: &str, hooks: &[String]) -> String {
    let hooks_toml: String = hooks
        .iter()
        .map(|h| format!("  \"{h}\""))
        .collect::<Vec<_>>()
        .join(",\n");

    format!(
        r#"# Zelqor Plugin Manifest
name = "{name}"
slug = "{slug}"
description = "{description}"
version = "0.1.0"
license = "MIT"
min_engine_version = ""

[metadata]
category = "other"
tags = []
homepage = ""
source = ""

hooks = [
{hooks_toml}
]

[dependencies]
# Add plugin dependencies here, e.g.:
# some-plugin = ">=1.0.0"

[config]
# Default configuration for this plugin (JSON-compatible TOML)

[permissions]
# Required permissions, e.g.:
# read_player_data = true
# modify_economy = true
"#
    )
}
