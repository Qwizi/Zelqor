use anyhow::{bail, Result};
use console::style;
use serde::Deserialize;

use crate::api::client::ApiClient;
use crate::config::{self, AuthConfig};
use crate::output;

#[derive(Deserialize)]
struct DeviceAuthResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct DeviceTokenError {
    error: Option<String>,
}

/// OAuth Device Authorization Flow (RFC 8628):
/// 1. CLI requests a device code from the backend (no client_id needed — uses built-in CLI app)
/// 2. User opens the verification URL in their browser and enters the code
/// 3. CLI polls the token endpoint until the user authorizes
pub async fn login(api_url_override: &Option<String>) -> Result<()> {
    output::header("Zelqor Login");

    let cfg = config::load()?;
    let base_url = cfg.effective_api_url(api_url_override);

    // Step 1: Request device code (no client_id — backend uses built-in CLI app)
    let sp = output::spinner("Requesting device code...");
    let http = reqwest::Client::new();
    let resp = http
        .post(format!("{}/oauth/device/", base_url))
        .json(&serde_json::json!({}))
        .send()
        .await?;
    sp.finish_and_clear();

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        bail!("Failed to get device code: {}", body);
    }

    let device: DeviceAuthResponse = resp.json().await?;

    // Step 2: Show the code to the user
    println!();
    println!(
        "  {} Open this URL in your browser:",
        style("→").cyan().bold()
    );
    println!();
    println!(
        "    {}",
        style(&device.verification_uri).underlined().bold()
    );
    println!();
    println!(
        "  {} Enter this code:  {}",
        style("→").cyan().bold(),
        style(&device.user_code).bold().yellow()
    );
    println!();

    // Try to open browser
    let url_with_code = format!("{}?code={}", device.verification_uri, device.user_code);
    if open::that(&url_with_code).is_err() {
        output::info("Could not open browser automatically. Open the URL manually.");
    }

    // Step 3: Poll for authorization
    let sp = output::spinner("Waiting for authorization...");
    let poll_interval = std::time::Duration::from_secs(device.interval.max(3));
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(device.expires_in);

    let token_resp = loop {
        tokio::time::sleep(poll_interval).await;

        if std::time::Instant::now() > deadline {
            sp.finish_and_clear();
            bail!("Device code expired. Run `zelqor login` again.");
        }

        let resp = http
            .post(format!("{}/oauth/token/", base_url))
            .json(&serde_json::json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device.device_code,
            }))
            .send()
            .await?;

        if resp.status().is_success() {
            let tokens: crate::api::models::TokenResponse = resp.json().await?;
            break tokens;
        }

        // Check if it's a pending or expired error
        let body = resp.text().await.unwrap_or_default();
        if let Ok(err) = serde_json::from_str::<DeviceTokenError>(&body) {
            match err.error.as_deref() {
                Some("authorization_pending") => continue,
                Some("expired_token") => {
                    sp.finish_and_clear();
                    bail!("Device code expired. Run `zelqor login` again.");
                }
                Some(other) => {
                    sp.finish_and_clear();
                    bail!("Authorization failed: {}", other);
                }
                None => continue,
            }
        }
    };
    sp.finish_and_clear();

    output::success("Authorized!");

    // Step 4: Optionally select a developer app
    let sp = output::spinner("Fetching your apps...");
    let client = ApiClient::new(&base_url, Some(&token_resp.access_token));
    let apps = client.list_apps().await.unwrap_or_default();
    sp.finish_and_clear();

    let app_id = if !apps.is_empty() {
        let mut choices: Vec<String> = apps
            .iter()
            .map(|a| format!("{} ({})", a.name, &a.id[..8]))
            .collect();
        choices.push("Skip".to_string());
        let idx = dialoguer::Select::new()
            .with_prompt("Associate with a developer app?")
            .items(&choices)
            .default(0)
            .interact()?;
        if idx < apps.len() {
            Some(apps[idx].id.clone())
        } else {
            None
        }
    } else {
        None
    };

    // Step 5: Save config
    let mut cfg = config::load()?;
    cfg.auth = Some(AuthConfig {
        access_token: token_resp.access_token,
        refresh_token: token_resp.refresh_token,
        app_id,
    });
    if let Some(url) = api_url_override {
        cfg.api_url = Some(url.clone());
    }
    config::save(&cfg)?;

    output::success("Logged in successfully!");
    if let Some(path) = config::config_path().ok() {
        output::info(&format!("Config saved to {}", path.display()));
    }
    Ok(())
}

pub async fn logout() -> Result<()> {
    let mut cfg = config::load()?;
    if cfg.auth.is_none() {
        output::warn("You are not currently logged in.");
        return Ok(());
    }
    cfg.auth = None;
    config::save(&cfg)?;
    output::success("Logged out. Credentials removed.");
    Ok(())
}

pub async fn whoami(api_url_override: &Option<String>) -> Result<()> {
    let cfg = config::load()?;

    let auth = cfg.auth.as_ref().ok_or_else(|| {
        anyhow::anyhow!("Not authenticated. Run `zelqor login` first.")
    })?;

    let base_url = cfg.effective_api_url(api_url_override);
    let client = ApiClient::new(&base_url, Some(&auth.access_token));

    let sp = output::spinner("Fetching account info...");
    let apps = client.list_apps().await;
    sp.finish_and_clear();

    output::header("Current Session");
    output::print_kv(&[
        ("API URL", base_url),
        (
            "App ID",
            auth.app_id
                .clone()
                .unwrap_or_else(|| "(none)".to_string()),
        ),
        (
            "Refresh Token",
            if auth.refresh_token.is_some() {
                "present".to_string()
            } else {
                "none".to_string()
            },
        ),
    ]);

    match apps {
        Ok(apps) => {
            println!();
            output::header(&format!("Developer Apps ({})", apps.len()));
            for app in &apps {
                println!(
                    "  {} {} {}",
                    style(&app.name).bold(),
                    style(format!("({})", &app.id[..8])).dim(),
                    if app.is_active {
                        style("active").green().to_string()
                    } else {
                        style("inactive").red().to_string()
                    }
                );
            }
        }
        Err(e) => {
            output::warn(&format!("Could not fetch apps: {}", e));
        }
    }

    Ok(())
}
