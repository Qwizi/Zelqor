use maplord_engine::{Action, Player, Region};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Kind of violation detected by the anti-cheat system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ViolationKind {
    /// Player consistently sends too many actions per tick.
    ActionFlood,
    /// Actions arrive with inhuman timing (< 50ms apart consistently).
    ImpossibleTiming,
    /// Player repeats the exact same action sequence — likely a bot/macro.
    RepetitivePattern,
    /// Player attacks or interacts with a region outside their visibility range.
    FogOfWarAbuse,
}

impl std::fmt::Display for ViolationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ViolationKind::ActionFlood => write!(f, "action_flood"),
            ViolationKind::ImpossibleTiming => write!(f, "impossible_timing"),
            ViolationKind::RepetitivePattern => write!(f, "repetitive_pattern"),
            ViolationKind::FogOfWarAbuse => write!(f, "fog_of_war_abuse"),
        }
    }
}

/// A single violation instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Violation {
    pub kind: ViolationKind,
    pub player_id: String,
    pub tick: i64,
    pub severity: u8,
    pub detail: String,
}

/// What the game loop should do after anti-cheat analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnticheatVerdict {
    /// Nothing suspicious — continue normally.
    Allow,
    /// Suspicious activity detected — logged but no action taken yet.
    Warn { player_id: String, reason: String },
    /// Player confirmed cheating — eliminate from match.
    FlagPlayer { player_id: String, reason: String },
    /// Match integrity compromised — cancel and compensate.
    CancelMatch { reason: String },
}

// ---------------------------------------------------------------------------
// Per-player tracking (in-memory, per match)
// ---------------------------------------------------------------------------

/// Tracks a single player's behavioral profile during a match.
#[derive(Debug, Clone)]
struct PlayerProfile {
    /// Number of actions per tick: ring buffer of last N ticks.
    actions_per_tick: Vec<u32>,
    /// Timestamps (ms since match start) of last N actions for timing analysis.
    action_timestamps_ms: Vec<u64>,
    /// Last N action signatures for repetition detection.
    recent_action_sigs: Vec<u64>,
    /// Accumulated violation score (0-100). At thresholds we escalate.
    violation_score: u32,
    /// Number of warnings already issued.
    warnings_issued: u32,
}

impl PlayerProfile {
    fn new() -> Self {
        Self {
            actions_per_tick: Vec::with_capacity(64),
            action_timestamps_ms: Vec::with_capacity(128),
            recent_action_sigs: Vec::with_capacity(128),
            violation_score: 0,
            warnings_issued: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Action log entry (persisted to Redis)
// ---------------------------------------------------------------------------

/// Compact action log entry stored in Redis for post-match analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionLogEntry {
    pub tick: i64,
    pub player_id: String,
    pub action_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_region_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_region_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub units: Option<i64>,
}

impl From<(&Action, i64)> for ActionLogEntry {
    fn from((action, tick): (&Action, i64)) -> Self {
        Self {
            tick,
            player_id: action.player_id.clone().unwrap_or_default(),
            action_type: action.action_type.clone(),
            source_region_id: action.source_region_id.clone(),
            target_region_id: action.target_region_id.clone(),
            region_id: action.region_id.clone(),
            units: action.units,
        }
    }
}

// ---------------------------------------------------------------------------
// Constants / thresholds
// ---------------------------------------------------------------------------

/// Max actions per tick before flagging (sustained over FLOOD_WINDOW ticks).
const FLOOD_THRESHOLD: u32 = 20;
/// How many ticks the flood must persist to trigger.
const FLOOD_WINDOW: usize = 5;
/// Minimum inter-action time (ms) — below this consistently = inhuman.
const MIN_ACTION_INTERVAL_MS: u64 = 50;
/// How many consecutive fast actions trigger timing violation.
const TIMING_WINDOW: usize = 10;
/// Length of action signature sequence to check for repetition.
const REPETITION_SEQ_LEN: usize = 8;
/// How many times the same sequence must repeat to flag.
const REPETITION_MIN_REPEATS: usize = 3;
/// Score threshold for Warn verdict.
const WARN_THRESHOLD: u32 = 30;
/// Score threshold for FlagPlayer verdict.
const FLAG_THRESHOLD: u32 = 70;
/// Score threshold for CancelMatch verdict.
const CANCEL_THRESHOLD: u32 = 100;
/// Max number of action log entries kept per match in Redis.
const MAX_ACTION_LOG_SIZE: i64 = 10_000;

// ---------------------------------------------------------------------------
// AnticheatEngine
// ---------------------------------------------------------------------------

/// Real-time anti-cheat engine — one instance per active match.
pub struct AnticheatEngine {
    match_id: String,
    redis: ConnectionManager,
    profiles: HashMap<String, PlayerProfile>,
    /// Monotonic counter incremented each time we record action timestamps.
    match_start_ms: u64,
}

impl AnticheatEngine {
    /// Create a new engine for a match.
    pub fn new(match_id: String, redis: ConnectionManager) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self {
            match_id,
            redis,
            profiles: HashMap::new(),
            match_start_ms: now,
        }
    }

    fn key(&self, suffix: &str) -> String {
        format!("anticheat:{}:{}", self.match_id, suffix)
    }

    fn profile(&mut self, player_id: &str) -> &mut PlayerProfile {
        self.profiles
            .entry(player_id.to_string())
            .or_insert_with(PlayerProfile::new)
    }

    // -----------------------------------------------------------------------
    // Action logging (Redis persistence)
    // -----------------------------------------------------------------------

    /// Log a batch of actions for this tick to Redis.
    /// Called once per tick with all actions before engine processes them.
    pub async fn log_actions(&mut self, actions: &[Action], tick: i64) {
        if actions.is_empty() {
            return;
        }

        let key = self.key("action_log");
        let mut pipe = redis::pipe();

        for action in actions {
            let entry = ActionLogEntry::from((action, tick));
            if let Ok(packed) = rmp_serde::to_vec(&entry) {
                pipe.rpush(&key, packed).ignore();
            }
        }

        // Trim to keep bounded — drop oldest entries
        pipe.cmd("LTRIM")
            .arg(&key)
            .arg(-MAX_ACTION_LOG_SIZE)
            .arg(-1)
            .ignore();

        // TTL: 2 hours (enough for post-match analysis)
        pipe.expire(&key, 7200).ignore();

        let mut conn = self.redis.clone();
        if let Err(e) = pipe.exec_async(&mut conn).await {
            tracing::warn!("anticheat: failed to log actions for match {}: {e}", self.match_id);
        }
    }

    /// Retrieve action log for post-match analysis.
    pub async fn get_action_log(&self) -> Vec<ActionLogEntry> {
        let mut conn = self.redis.clone();
        let key = self.key("action_log");
        let raw: Vec<Vec<u8>> = conn.lrange(&key, 0, -1).await.unwrap_or_default();
        raw.iter()
            .filter_map(|v| rmp_serde::from_slice(v).ok())
            .collect()
    }

    // -----------------------------------------------------------------------
    // Violation logging (Redis persistence)
    // -----------------------------------------------------------------------

    /// Persist a violation to Redis for this match.
    async fn log_violation(&mut self, violation: &Violation) {
        let key = self.key("violations");
        if let Ok(packed) = rmp_serde::to_vec(violation) {
            let mut conn = self.redis.clone();
            let _: Result<(), _> = conn.rpush(&key, packed).await;
            let _: Result<(), _> = conn.expire(&key, 7200).await;
        }
        tracing::warn!(
            "anticheat: match={} player={} violation={} severity={} — {}",
            self.match_id,
            violation.player_id,
            violation.kind,
            violation.severity,
            violation.detail,
        );
    }

    /// Get all violations for this match.
    pub async fn get_violations(&self) -> Vec<Violation> {
        let mut conn = self.redis.clone();
        let key = self.key("violations");
        let raw: Vec<Vec<u8>> = conn.lrange(&key, 0, -1).await.unwrap_or_default();
        raw.iter()
            .filter_map(|v| rmp_serde::from_slice(v).ok())
            .collect()
    }

    // -----------------------------------------------------------------------
    // Main analysis entry point — called once per tick
    // -----------------------------------------------------------------------

    /// Analyze actions for the current tick. Returns the worst verdict.
    ///
    /// Call this BEFORE `engine.process_tick()` so we can filter/flag actions.
    pub async fn analyze_tick(
        &mut self,
        actions: &[Action],
        tick: i64,
        regions: &HashMap<String, Region>,
        players: &HashMap<String, Player>,
        neighbor_map: &HashMap<String, Vec<String>>,
    ) -> AnticheatVerdict {
        // Log actions to Redis
        self.log_actions(actions, tick).await;

        // Group actions by player
        let mut per_player: HashMap<String, Vec<&Action>> = HashMap::new();
        for action in actions {
            if let Some(pid) = &action.player_id {
                // Skip bots
                if players.get(pid).map_or(false, |p| p.is_bot) {
                    continue;
                }
                per_player.entry(pid.clone()).or_default().push(action);
            }
        }

        let mut violations = Vec::new();

        for (player_id, player_actions) in &per_player {
            // 1. Action flood detection
            if let Some(v) = self.check_action_flood(player_id, player_actions.len() as u32, tick)
            {
                violations.push(v);
            }

            // 2. Impossible timing detection
            if let Some(v) = self.check_impossible_timing(player_id, player_actions.len(), tick) {
                violations.push(v);
            }

            // 3. Repetitive pattern detection
            if let Some(v) =
                self.check_repetitive_pattern(player_id, player_actions, tick)
            {
                violations.push(v);
            }

            // 4. Fog-of-war abuse detection (deduplicated: max 1 per tick per player)
            let mut fog_count = 0u32;
            for action in player_actions {
                if self.check_fog_of_war(player_id, action, tick, regions, neighbor_map).is_some() {
                    fog_count += 1;
                }
            }
            if fog_count > 0 {
                violations.push(Violation {
                    kind: ViolationKind::FogOfWarAbuse,
                    player_id: player_id.clone(),
                    tick,
                    severity: 35,
                    detail: format!(
                        "{fog_count} attacks on regions outside visibility range"
                    ),
                });
            }
        }

        // Persist violations (deduplicated: max 1 per kind per player per tick)
        let mut seen = std::collections::HashSet::new();
        let violations: Vec<Violation> = violations
            .into_iter()
            .filter(|v| seen.insert((v.player_id.clone(), v.kind.clone())))
            .collect();

        let mut worst = AnticheatVerdict::Allow;
        for violation in &violations {
            self.log_violation(violation).await;

            let profile = self.profile(&violation.player_id);
            profile.violation_score = profile.violation_score.saturating_add(violation.severity as u32);

            let verdict = if profile.violation_score >= CANCEL_THRESHOLD {
                AnticheatVerdict::CancelMatch {
                    reason: format!(
                        "Player {} accumulated violation score {} (threshold {})",
                        violation.player_id, profile.violation_score, CANCEL_THRESHOLD
                    ),
                }
            } else if profile.violation_score >= FLAG_THRESHOLD {
                AnticheatVerdict::FlagPlayer {
                    player_id: violation.player_id.clone(),
                    reason: format!(
                        "{} — score {} (threshold {})",
                        violation.detail, profile.violation_score, FLAG_THRESHOLD
                    ),
                }
            } else if profile.violation_score >= WARN_THRESHOLD
                && profile.warnings_issued < 3
            {
                profile.warnings_issued += 1;
                AnticheatVerdict::Warn {
                    player_id: violation.player_id.clone(),
                    reason: violation.detail.clone(),
                }
            } else {
                AnticheatVerdict::Allow
            };

            // Keep the worst verdict
            worst = worse_verdict(worst, verdict);
        }

        worst
    }

    // -----------------------------------------------------------------------
    // Detector: Action Flood
    // -----------------------------------------------------------------------

    fn check_action_flood(
        &mut self,
        player_id: &str,
        action_count: u32,
        tick: i64,
    ) -> Option<Violation> {
        let profile = self.profile(player_id);
        profile.actions_per_tick.push(action_count);

        // Only check if we have enough history
        if profile.actions_per_tick.len() < FLOOD_WINDOW {
            return None;
        }

        // Check last N ticks
        let window = &profile.actions_per_tick[profile.actions_per_tick.len() - FLOOD_WINDOW..];
        let all_above = window.iter().all(|&count| count >= FLOOD_THRESHOLD);

        if all_above {
            let avg: f64 =
                window.iter().map(|&c| c as f64).sum::<f64>() / FLOOD_WINDOW as f64;
            Some(Violation {
                kind: ViolationKind::ActionFlood,
                player_id: player_id.to_string(),
                tick,
                severity: 15,
                detail: format!(
                    "Sustained {avg:.0} actions/tick over {FLOOD_WINDOW} ticks (threshold {FLOOD_THRESHOLD})"
                ),
            })
        } else {
            None
        }
    }

    // -----------------------------------------------------------------------
    // Detector: Impossible Timing
    // -----------------------------------------------------------------------

    fn check_impossible_timing(
        &mut self,
        player_id: &str,
        action_count: usize,
        tick: i64,
    ) -> Option<Violation> {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let profile = self.profile(player_id);

        // Record one timestamp per action (approximate — all in same tick)
        // Spread within the tick interval for more realistic measurement
        for i in 0..action_count {
            let ts = now_ms.saturating_sub((action_count - 1 - i) as u64);
            profile.action_timestamps_ms.push(ts);
        }

        // Keep bounded
        if profile.action_timestamps_ms.len() > 256 {
            let drain = profile.action_timestamps_ms.len() - 128;
            profile.action_timestamps_ms.drain(..drain);
        }

        // Check intervals between recent timestamps
        let timestamps = &profile.action_timestamps_ms;
        if timestamps.len() < TIMING_WINDOW + 1 {
            return None;
        }

        let recent = &timestamps[timestamps.len() - TIMING_WINDOW - 1..];
        let mut fast_count = 0u32;
        for w in recent.windows(2) {
            let interval = w[1].saturating_sub(w[0]);
            if interval < MIN_ACTION_INTERVAL_MS {
                fast_count += 1;
            }
        }

        // If most intervals are below threshold — suspicious
        if fast_count >= (TIMING_WINDOW as u32 * 8 / 10) {
            Some(Violation {
                kind: ViolationKind::ImpossibleTiming,
                player_id: player_id.to_string(),
                tick,
                severity: 20,
                detail: format!(
                    "{fast_count}/{TIMING_WINDOW} action intervals below {MIN_ACTION_INTERVAL_MS}ms"
                ),
            })
        } else {
            None
        }
    }

    // -----------------------------------------------------------------------
    // Detector: Repetitive Pattern
    // -----------------------------------------------------------------------

    fn check_repetitive_pattern(
        &mut self,
        player_id: &str,
        actions: &[&Action],
        tick: i64,
    ) -> Option<Violation> {
        let profile = self.profile(player_id);

        // Create simple hash signature for each action
        for action in actions {
            let sig = action_signature(action);
            profile.recent_action_sigs.push(sig);
        }

        // Keep bounded
        if profile.recent_action_sigs.len() > 256 {
            let drain = profile.recent_action_sigs.len() - 128;
            profile.recent_action_sigs.drain(..drain);
        }

        let sigs = &profile.recent_action_sigs;
        let min_len = REPETITION_SEQ_LEN * REPETITION_MIN_REPEATS;
        if sigs.len() < min_len {
            return None;
        }

        // Check if the last N sequences are identical
        let tail = &sigs[sigs.len() - min_len..];
        let pattern = &tail[..REPETITION_SEQ_LEN];
        let mut repeats = 0usize;
        for chunk in tail.chunks_exact(REPETITION_SEQ_LEN) {
            if chunk == pattern {
                repeats += 1;
            }
        }

        if repeats >= REPETITION_MIN_REPEATS {
            Some(Violation {
                kind: ViolationKind::RepetitivePattern,
                player_id: player_id.to_string(),
                tick,
                severity: 25,
                detail: format!(
                    "Identical {REPETITION_SEQ_LEN}-action sequence repeated {repeats} times"
                ),
            })
        } else {
            None
        }
    }

    // -----------------------------------------------------------------------
    // Detector: Fog-of-War Abuse
    // -----------------------------------------------------------------------

    fn check_fog_of_war(
        &mut self,
        player_id: &str,
        action: &Action,
        tick: i64,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
    ) -> Option<Violation> {
        // Only check attack actions (move is between own regions)
        if action.action_type != "attack" {
            return None;
        }

        let target_id = action.target_region_id.as_deref()?;

        // Build the set of regions this player can see:
        // own regions + neighbors of own regions (+ buildings with extra vision)
        let visible = compute_player_visibility(player_id, regions, neighbor_map);

        if !visible.contains(target_id) {
            Some(Violation {
                kind: ViolationKind::FogOfWarAbuse,
                player_id: player_id.to_string(),
                tick,
                severity: 35,
                detail: format!("Attacked region {target_id} which is outside visibility range"),
            })
        } else {
            None
        }
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /// Clean up Redis keys for this match.
    pub async fn cleanup(&self) {
        let mut conn = self.redis.clone();
        let keys = vec![self.key("action_log"), self.key("violations")];
        let _: Result<(), _> = redis::cmd("DEL")
            .arg(&keys)
            .exec_async(&mut conn)
            .await;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Simple hash of an action for repetition detection.
fn action_signature(action: &Action) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    action.action_type.hash(&mut hasher);
    action.source_region_id.hash(&mut hasher);
    action.target_region_id.hash(&mut hasher);
    action.region_id.hash(&mut hasher);
    action.units.hash(&mut hasher);
    action.unit_type.hash(&mut hasher);
    action.building_type.hash(&mut hasher);
    action.ability_type.hash(&mut hasher);
    hasher.finish()
}

/// Compute set of region IDs visible to a player.
/// Visible = owned regions + their neighbors (depth based on vision_range).
fn compute_player_visibility(
    player_id: &str,
    regions: &HashMap<String, Region>,
    neighbor_map: &HashMap<String, Vec<String>>,
) -> std::collections::HashSet<String> {
    let mut visible = std::collections::HashSet::new();

    // Collect owned regions and their vision range
    let mut sources: Vec<(&str, i64)> = Vec::new();
    for (rid, region) in regions {
        if region.owner_id.as_deref() == Some(player_id) {
            visible.insert(rid.clone());
            // Base vision = 1 hop, plus building bonus
            let vision = 1i64.max(region.vision_range);
            sources.push((rid, vision));
        }
    }

    // BFS from each owned region up to vision range
    for (start, range) in sources {
        let mut queue = std::collections::VecDeque::new();
        let mut visited = std::collections::HashSet::new();
        queue.push_back((start.to_string(), 0i64));
        visited.insert(start.to_string());

        while let Some((current, depth)) = queue.pop_front() {
            visible.insert(current.clone());
            if depth < range {
                if let Some(neighbors) = neighbor_map.get(&current) {
                    for n in neighbors {
                        if visited.insert(n.clone()) {
                            queue.push_back((n.clone(), depth + 1));
                        }
                    }
                }
            }
        }
    }

    visible
}

/// Return the more severe of two verdicts.
fn worse_verdict(a: AnticheatVerdict, b: AnticheatVerdict) -> AnticheatVerdict {
    fn severity(v: &AnticheatVerdict) -> u8 {
        match v {
            AnticheatVerdict::Allow => 0,
            AnticheatVerdict::Warn { .. } => 1,
            AnticheatVerdict::FlagPlayer { .. } => 2,
            AnticheatVerdict::CancelMatch { .. } => 3,
        }
    }
    if severity(&b) > severity(&a) { b } else { a }
}
