// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod steam;

use steam::SteamState;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "maplord_desktop=info".into()),
        )
        .init();

    // Initialize Steam (non-fatal — game works without Steam for dev)
    let steam_state = match SteamState::init() {
        Ok(state) => {
            tracing::info!("Steam initialized successfully");
            Some(state)
        }
        Err(e) => {
            tracing::warn!("Steam not available: {e} — running in standalone mode");
            None
        }
    };

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            steam::get_steam_user,
            steam::get_steam_auth_ticket,
            steam::is_steam_running,
            steam::activate_steam_overlay,
            steam::set_steam_achievement,
            steam::get_steam_achievements,
            steam::set_steam_rich_presence,
        ]);

    if let Some(state) = steam_state {
        builder = builder.manage(state);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running MapLord");
}
