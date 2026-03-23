//! Steamworks SDK integration — only compiled with `--features steam`.

use serde::Serialize;
use std::sync::Mutex;
use steamworks::{AppId, Client, SingleClient};
use tauri::State;

/// MapLord Steam App ID — replace with your actual App ID after Steamworks registration.
/// 480 = Spacewar (Valve's test app, works for development).
const STEAM_APP_ID: u32 = 480;

pub struct SteamState {
    client: Client,
    single: Mutex<SingleClient>,
}

// Safety: Client is thread-safe after initialization.
// SingleClient must only be used from one thread (behind Mutex).
unsafe impl Send for SteamState {}
unsafe impl Sync for SteamState {}

impl SteamState {
    pub fn init() -> Result<Self, String> {
        let (client, single) =
            Client::init_app(AppId(STEAM_APP_ID)).map_err(|e| format!("Steam init failed: {e}"))?;
        Ok(Self {
            client,
            single: Mutex::new(single),
        })
    }

    pub fn run_callbacks(&self) {
        if let Ok(single) = self.single.lock() {
            single.run_callbacks();
        }
    }
}

#[derive(Serialize)]
pub struct SteamUser {
    pub steam_id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct SteamAchievement {
    pub id: String,
    pub achieved: bool,
}

#[tauri::command]
pub fn is_steam_running(state: State<'_, SteamState>) -> bool {
    state.run_callbacks();
    true
}

#[tauri::command]
pub fn get_steam_user(state: State<'_, SteamState>) -> Result<SteamUser, String> {
    state.run_callbacks();
    let user = state.client.user();
    let steam_id = user.steam_id();
    let friends = state.client.friends();
    let name = friends.name();
    Ok(SteamUser {
        steam_id: steam_id.raw().to_string(),
        name,
    })
}

#[tauri::command]
pub fn get_steam_auth_ticket(state: State<'_, SteamState>) -> Result<String, String> {
    state.run_callbacks();
    let user = state.client.user();
    let (auth_ticket, _ticket_id) = user.authentication_session_ticket();
    Ok(auth_ticket
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>())
}

#[tauri::command]
pub fn activate_steam_overlay(state: State<'_, SteamState>) {
    state.run_callbacks();
    state.client.friends().activate_game_overlay("friends");
}

#[tauri::command]
pub fn set_steam_achievement(
    state: State<'_, SteamState>,
    achievement_id: String,
) -> Result<(), String> {
    state.run_callbacks();
    let user_stats = state.client.user_stats();
    user_stats
        .achievement(&achievement_id)
        .set()
        .map_err(|e| format!("Failed to set achievement: {e}"))?;
    user_stats
        .store_stats()
        .map_err(|e| format!("Failed to store stats: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_steam_achievements(
    state: State<'_, SteamState>,
) -> Result<Vec<SteamAchievement>, String> {
    state.run_callbacks();
    let user_stats = state.client.user_stats();

    let achievement_ids = [
        "FIRST_MATCH",
        "FIRST_WIN",
        "CONQUER_10",
        "CONQUER_50",
        "BUILD_ARMY",
        "WIN_STREAK_3",
        "WIN_STREAK_10",
        "MASTER_STRATEGIST",
    ];

    let achievements = achievement_ids
        .iter()
        .map(|id| {
            let ach = user_stats.achievement(id);
            SteamAchievement {
                id: id.to_string(),
                achieved: ach.get().unwrap_or(false),
            }
        })
        .collect();

    Ok(achievements)
}

#[tauri::command]
pub fn set_steam_rich_presence(
    state: State<'_, SteamState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.run_callbacks();
    state
        .client
        .friends()
        .set_rich_presence(&key, Some(&value));
    Ok(())
}
