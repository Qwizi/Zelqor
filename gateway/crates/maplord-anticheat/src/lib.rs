use maplord_engine::{Action, Player, Region};
use metrics::counter;
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
/// Assumed tick window (ms) used to spread artificial timestamps when real
/// per-action timestamps are unavailable. Matches the engine's ~1 s tick rate.
const TICK_WINDOW_MS: u64 = 1000;
/// How many consecutive fast actions trigger timing violation.
const TIMING_WINDOW: usize = 15;
/// Length of action signature sequence to check for repetition.
const REPETITION_SEQ_LEN: usize = 8;
/// How many times the same sequence must repeat to flag.
const REPETITION_MIN_REPEATS: usize = 3;
/// Score threshold for Warn verdict.
const WARN_THRESHOLD: u32 = 30;
/// Score threshold for FlagPlayer verdict.
const FLAG_THRESHOLD: u32 = 100;
/// Score threshold for CancelMatch verdict.
const CANCEL_THRESHOLD: u32 = 150;
/// Max number of action log entries kept per match in Redis.
const MAX_ACTION_LOG_SIZE: i64 = 10_000;

// ---------------------------------------------------------------------------
// AnticheatEngine
// ---------------------------------------------------------------------------

/// Pure in-memory detection state — all profile tracking with no I/O.
/// Extracted as a separate struct so unit tests can exercise detection logic
/// without requiring a live Redis `ConnectionManager`.
pub(crate) struct Detectors {
    pub(crate) profiles: HashMap<String, PlayerProfile>,
}

impl Detectors {
    pub(crate) fn new() -> Self {
        Self {
            profiles: HashMap::new(),
        }
    }

    pub(crate) fn profile(&mut self, player_id: &str) -> &mut PlayerProfile {
        self.profiles
            .entry(player_id.to_string())
            .or_insert_with(PlayerProfile::new)
    }

    pub(crate) fn check_action_flood(
        &mut self,
        player_id: &str,
        action_count: u32,
        tick: i64,
    ) -> Option<Violation> {
        let profile = self.profile(player_id);
        profile.actions_per_tick.push(action_count);

        if profile.actions_per_tick.len() < FLOOD_WINDOW {
            return None;
        }

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

    pub(crate) fn check_impossible_timing(
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

        // Spread artificial timestamps evenly across the tick window so that
        // actions legitimately batched in a single tick are not treated as if
        // they arrived 1 ms apart (which always triggers the timing detector).
        // With action_count == 1 the interval is irrelevant; for N > 1 we use
        // TICK_WINDOW_MS / N so the inferred interval reflects a realistic
        // human clicking rate within that tick.
        let interval_ms = if action_count > 1 {
            TICK_WINDOW_MS / action_count as u64
        } else {
            TICK_WINDOW_MS
        };
        for i in 0..action_count {
            let ts = now_ms.saturating_sub((action_count - 1 - i) as u64 * interval_ms);
            profile.action_timestamps_ms.push(ts);
        }

        if profile.action_timestamps_ms.len() > 256 {
            let drain = profile.action_timestamps_ms.len() - 128;
            profile.action_timestamps_ms.drain(..drain);
        }

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

        if fast_count >= (TIMING_WINDOW as u32 * 9 / 10) {
            Some(Violation {
                kind: ViolationKind::ImpossibleTiming,
                player_id: player_id.to_string(),
                tick,
                severity: 5,
                detail: format!(
                    "{fast_count}/{TIMING_WINDOW} action intervals below {MIN_ACTION_INTERVAL_MS}ms"
                ),
            })
        } else {
            None
        }
    }

    pub(crate) fn check_repetitive_pattern(
        &mut self,
        player_id: &str,
        actions: &[&Action],
        tick: i64,
    ) -> Option<Violation> {
        let profile = self.profile(player_id);

        for action in actions {
            let sig = action_signature(action);
            profile.recent_action_sigs.push(sig);
        }

        if profile.recent_action_sigs.len() > 256 {
            let drain = profile.recent_action_sigs.len() - 128;
            profile.recent_action_sigs.drain(..drain);
        }

        let sigs = &profile.recent_action_sigs;
        let min_len = REPETITION_SEQ_LEN * REPETITION_MIN_REPEATS;
        if sigs.len() < min_len {
            return None;
        }

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

    pub(crate) fn check_fog_of_war(
        player_id: &str,
        action: &Action,
        tick: i64,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
    ) -> Option<Violation> {
        if action.action_type != "attack" {
            return None;
        }

        let target_id = action.target_region_id.as_deref()?;

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

    pub(crate) fn violation_score(&self, player_id: &str) -> u32 {
        self.profiles
            .get(player_id)
            .map(|p| p.violation_score)
            .unwrap_or(0)
    }

    pub(crate) fn apply_violation_score(&mut self, player_id: &str, severity: u32) {
        let profile = self.profile(player_id);
        profile.violation_score = profile.violation_score.saturating_add(severity);
    }

    pub(crate) fn worst_verdict_for_score(
        &mut self,
        player_id: &str,
        detail: &str,
    ) -> AnticheatVerdict {
        let profile = self.profile(player_id);
        if profile.violation_score >= CANCEL_THRESHOLD {
            AnticheatVerdict::CancelMatch {
                reason: format!(
                    "Player {player_id} accumulated violation score {} (threshold {CANCEL_THRESHOLD})",
                    profile.violation_score
                ),
            }
        } else if profile.violation_score >= FLAG_THRESHOLD {
            AnticheatVerdict::FlagPlayer {
                player_id: player_id.to_string(),
                reason: format!(
                    "{detail} — score {} (threshold {FLAG_THRESHOLD})",
                    profile.violation_score
                ),
            }
        } else if profile.violation_score >= WARN_THRESHOLD && profile.warnings_issued < 3 {
            profile.warnings_issued += 1;
            AnticheatVerdict::Warn {
                player_id: player_id.to_string(),
                reason: detail.to_string(),
            }
        } else {
            AnticheatVerdict::Allow
        }
    }
}

/// Real-time anti-cheat engine — one instance per active match.
pub struct AnticheatEngine {
    match_id: String,
    redis: ConnectionManager,
    detectors: Detectors,
    /// Wall-clock ms at match start, used to compute relative action timestamps.
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
            detectors: Detectors::new(),
            match_start_ms: now,
        }
    }

    fn key(&self, suffix: &str) -> String {
        format!("anticheat:{}:{}", self.match_id, suffix)
    }

    fn profile(&mut self, player_id: &str) -> &mut PlayerProfile {
        self.detectors.profile(player_id)
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
            if let Some(v) = self.detectors.check_action_flood(player_id, player_actions.len() as u32, tick)
            {
                violations.push(v);
            }

            // 2. Impossible timing detection
            if let Some(v) = self.detectors.check_impossible_timing(player_id, player_actions.len(), tick) {
                violations.push(v);
            }

            // 3. Repetitive pattern detection
            if let Some(v) =
                self.detectors.check_repetitive_pattern(player_id, player_actions, tick)
            {
                violations.push(v);
            }

            // 4. Fog-of-war abuse detection (deduplicated: max 1 per tick per player)
            let mut fog_count = 0u32;
            for action in player_actions {
                if Detectors::check_fog_of_war(player_id, action, tick, regions, neighbor_map).is_some() {
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
            counter!(
                "game_anticheat_violations_total",
                "kind" => violation.kind.to_string(),
                "severity" => violation.severity.to_string()
            ).increment(1);

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

#[cfg(test)]
mod tests {
    use super::*;
    use maplord_engine::Action;

    // -----------------------------------------------------------------------
    // Shared test helpers
    // -----------------------------------------------------------------------

    fn attack_action(player_id: &str, source: &str, target: &str) -> Action {
        Action {
            action_type: "attack".into(),
            player_id: Some(player_id.to_string()),
            source_region_id: Some(source.to_string()),
            target_region_id: Some(target.to_string()),
            ..Default::default()
        }
    }

    fn move_action(player_id: &str, source: &str, target: &str) -> Action {
        Action {
            action_type: "move".into(),
            player_id: Some(player_id.to_string()),
            source_region_id: Some(source.to_string()),
            target_region_id: Some(target.to_string()),
            ..Default::default()
        }
    }

    fn make_region(owner: Option<&str>, vision_range: i64) -> Region {
        Region {
            owner_id: owner.map(str::to_string),
            vision_range,
            ..Default::default()
        }
    }

    // -----------------------------------------------------------------------
    // Detectors::new
    // -----------------------------------------------------------------------

    mod detectors_new {
        use super::*;

        #[test]
        fn starts_with_empty_profiles() {
            let d = Detectors::new();

            assert!(d.profiles.is_empty(), "new Detectors should have no profiles");
        }
    }

    // -----------------------------------------------------------------------
    // check_action_flood
    // -----------------------------------------------------------------------

    mod check_action_flood {
        use super::*;

        #[test]
        fn returns_none_before_window_is_full() {
            let mut d = Detectors::new();

            // FLOOD_WINDOW = 5; feed 4 ticks
            for tick in 0..4 {
                let result = d.check_action_flood("p1", FLOOD_THRESHOLD + 1, tick);
                assert!(result.is_none(), "should not fire before window is full (tick {tick})");
            }
        }

        #[test]
        fn returns_none_for_normal_action_rate() {
            let mut d = Detectors::new();

            // Send exactly at threshold minus one for FLOOD_WINDOW ticks
            for tick in 0..FLOOD_WINDOW as i64 {
                let result = d.check_action_flood("p1", FLOOD_THRESHOLD - 1, tick);
                assert!(result.is_none(), "below-threshold rate should not fire (tick {tick})");
            }
        }

        #[test]
        fn detects_sustained_action_flood() {
            let mut d = Detectors::new();

            // Fill the window with high counts
            let mut last = None;
            for tick in 0..FLOOD_WINDOW as i64 {
                last = d.check_action_flood("p1", FLOOD_THRESHOLD + 5, tick);
            }

            assert!(
                last.is_some(),
                "sustained high action rate should produce a violation after {FLOOD_WINDOW} ticks"
            );
            assert_eq!(
                last.unwrap().kind,
                ViolationKind::ActionFlood,
                "violation kind should be ActionFlood"
            );
        }

        #[test]
        fn flood_violation_carries_correct_player_id() {
            let mut d = Detectors::new();

            let mut last = None;
            for tick in 0..FLOOD_WINDOW as i64 {
                last = d.check_action_flood("player-abc", FLOOD_THRESHOLD + 1, tick);
            }

            assert_eq!(last.unwrap().player_id, "player-abc");
        }

        #[test]
        fn resets_when_rate_drops_below_threshold() {
            let mut d = Detectors::new();

            // Fill 4 ticks at high rate, then one tick at low rate — window is broken
            for tick in 0..4 {
                d.check_action_flood("p1", FLOOD_THRESHOLD + 1, tick);
            }
            // Low tick breaks the window
            d.check_action_flood("p1", 1, 4);

            // Fill a full new window all above threshold — should fire now
            let mut last = None;
            for tick in 5..(5 + FLOOD_WINDOW as i64) {
                last = d.check_action_flood("p1", FLOOD_THRESHOLD + 1, tick);
            }

            assert!(
                last.is_some(),
                "flood should re-trigger after a clean window at high rate"
            );
        }
    }

    // -----------------------------------------------------------------------
    // check_impossible_timing
    // -----------------------------------------------------------------------

    mod check_impossible_timing {
        use super::*;

        #[test]
        fn returns_none_with_insufficient_history() {
            let mut d = Detectors::new();

            // TIMING_WINDOW = 10; push only 5 actions
            let result = d.check_impossible_timing("p1", 5, 1);

            assert!(result.is_none(), "not enough history to evaluate timing yet");
        }

        #[test]
        fn detects_flood_of_actions_in_single_tick() {
            // Feed TIMING_WINDOW+2 actions all in one tick — all timestamps will be
            // within 1ms of each other (since the spread is action_count-1 ms).
            let mut d = Detectors::new();

            // First call sets up timestamps: 11 actions → timestamps spread across 10ms
            let result = d.check_impossible_timing("p1", TIMING_WINDOW + 2, 1);

            // All intervals will be 1ms, which is < MIN_ACTION_INTERVAL_MS (50ms)
            assert!(
                result.is_some(),
                "11 actions in one tick should trigger impossible timing"
            );
            assert_eq!(result.unwrap().kind, ViolationKind::ImpossibleTiming);
        }

        #[test]
        fn allows_normal_one_action_per_tick() {
            let mut d = Detectors::new();

            // Single action per tick — timestamps will be spread by real wall-clock differences
            // between iterations. With 1 action/call the spread subtraction does nothing
            // so timestamps equal current wall time on each call. We need > TIMING_WINDOW+1
            // samples and real-time gaps will be >> 50ms between loop iterations over
            // multiple ticks. However this test is unit-level so just check no false positive
            // on small counts.
            let mut last = None;
            for tick in 0..5 {
                last = d.check_impossible_timing("p1", 1, tick);
            }

            // With only 5 samples (< TIMING_WINDOW+1 = 11), should be None
            assert!(last.is_none(), "fewer than TIMING_WINDOW+1 samples should return None");
        }
    }

    // -----------------------------------------------------------------------
    // check_repetitive_pattern
    // -----------------------------------------------------------------------

    mod check_repetitive_pattern {
        use super::*;

        fn make_seq(player_id: &str, index: usize) -> Action {
            // Distinct actions so we can control pattern content
            Action {
                action_type: format!("attack_{index}"),
                player_id: Some(player_id.to_string()),
                source_region_id: Some(format!("src_{index}")),
                target_region_id: Some(format!("tgt_{index}")),
                ..Default::default()
            }
        }

        #[test]
        fn returns_none_before_minimum_pattern_length() {
            let mut d = Detectors::new();
            let actions: Vec<Action> = (0..REPETITION_SEQ_LEN).map(|i| make_seq("p1", i)).collect();
            let refs: Vec<&Action> = actions.iter().collect();

            // Only one sequence — not enough to detect repetition
            let result = d.check_repetitive_pattern("p1", &refs, 1);

            assert!(result.is_none(), "single sequence should not trigger repetition detection");
        }

        #[test]
        fn detects_exact_repeated_sequence() {
            let mut d = Detectors::new();

            // Build REPETITION_SEQ_LEN distinct actions as a pattern
            let pattern_actions: Vec<Action> = (0..REPETITION_SEQ_LEN).map(|i| make_seq("p1", i)).collect();
            let pattern_refs: Vec<&Action> = pattern_actions.iter().collect();

            // Submit the same pattern REPETITION_MIN_REPEATS times
            let mut last = None;
            for rep in 0..REPETITION_MIN_REPEATS as i64 {
                last = d.check_repetitive_pattern("p1", &pattern_refs, rep);
            }

            assert!(
                last.is_some(),
                "exact pattern repeated {REPETITION_MIN_REPEATS} times should trigger"
            );
            assert_eq!(last.unwrap().kind, ViolationKind::RepetitivePattern);
        }

        #[test]
        fn does_not_trigger_for_varied_actions() {
            let mut d = Detectors::new();

            // Each tick has a unique action — no repetition
            for tick in 0..(REPETITION_SEQ_LEN * REPETITION_MIN_REPEATS) as i64 {
                let unique_action = make_seq("p1", tick as usize);
                let refs = vec![&unique_action];
                let result = d.check_repetitive_pattern("p1", &refs, tick);
                assert!(result.is_none(), "varied actions should not trigger repetition (tick {tick})");
            }
        }
    }

    // -----------------------------------------------------------------------
    // check_fog_of_war (pure static method on Detectors)
    // -----------------------------------------------------------------------

    mod check_fog_of_war {
        use super::*;

        fn build_linear_map() -> (HashMap<String, Region>, HashMap<String, Vec<String>>) {
            // A — B — C — D
            // Player owns A (vision_range=1, so can see B)
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some("p1"), 1));
            regions.insert("B".into(), make_region(None, 0));
            regions.insert("C".into(), make_region(None, 0));
            regions.insert("D".into(), make_region(None, 0));

            let mut neighbors = HashMap::new();
            neighbors.insert("A".into(), vec!["B".into()]);
            neighbors.insert("B".into(), vec!["A".into(), "C".into()]);
            neighbors.insert("C".into(), vec!["B".into(), "D".into()]);
            neighbors.insert("D".into(), vec!["C".into()]);

            (regions, neighbors)
        }

        #[test]
        fn allows_attack_on_visible_neighbor() {
            let (regions, neighbors) = build_linear_map();
            let action = attack_action("p1", "A", "B");

            let result = Detectors::check_fog_of_war("p1", &action, 1, &regions, &neighbors);

            assert!(result.is_none(), "attack on adjacent visible region should be allowed");
        }

        #[test]
        fn flags_attack_on_region_outside_visibility() {
            let (regions, neighbors) = build_linear_map();
            // D is 3 hops away, outside vision_range=1 (+1 hop BFS = 2 visible regions)
            let action = attack_action("p1", "A", "D");

            let result = Detectors::check_fog_of_war("p1", &action, 1, &regions, &neighbors);

            assert!(result.is_some(), "attack on region 3 hops away should be flagged");
            assert_eq!(result.unwrap().kind, ViolationKind::FogOfWarAbuse);
        }

        #[test]
        fn ignores_non_attack_actions() {
            let (regions, neighbors) = build_linear_map();
            // Move to D — even though D is outside vision, only attacks are checked
            let action = move_action("p1", "A", "D");

            let result = Detectors::check_fog_of_war("p1", &action, 1, &regions, &neighbors);

            assert!(result.is_none(), "non-attack actions should not trigger fog-of-war check");
        }

        #[test]
        fn allows_attack_on_owned_region() {
            let (regions, neighbors) = build_linear_map();
            // Add a second owned region
            let mut regions = regions;
            regions.insert("E".into(), make_region(Some("p1"), 0));
            let mut neighbors = neighbors;
            neighbors.get_mut("A").unwrap().push("E".into());
            neighbors.insert("E".into(), vec!["A".into()]);

            let action = attack_action("p1", "A", "E");

            let result = Detectors::check_fog_of_war("p1", &action, 1, &regions, &neighbors);

            assert!(result.is_none(), "attack on own visible region should be allowed");
        }

        #[test]
        fn returns_none_when_action_has_no_target() {
            let (regions, neighbors) = build_linear_map();
            let action = Action {
                action_type: "attack".into(),
                player_id: Some("p1".into()),
                source_region_id: Some("A".into()),
                target_region_id: None, // no target
                ..Default::default()
            };

            let result = Detectors::check_fog_of_war("p1", &action, 1, &regions, &neighbors);

            assert!(result.is_none(), "attack with no target should not produce a violation");
        }
    }

    // -----------------------------------------------------------------------
    // Violation score escalation via Detectors::worst_verdict_for_score
    // -----------------------------------------------------------------------

    mod violation_score_escalation {
        use super::*;

        #[test]
        fn returns_allow_when_score_is_zero() {
            let mut d = Detectors::new();

            let verdict = d.worst_verdict_for_score("p1", "some detail");

            assert_eq!(verdict, AnticheatVerdict::Allow);
        }

        #[test]
        fn returns_warn_at_warn_threshold() {
            let mut d = Detectors::new();
            d.apply_violation_score("p1", WARN_THRESHOLD);

            let verdict = d.worst_verdict_for_score("p1", "suspicious");

            assert!(
                matches!(verdict, AnticheatVerdict::Warn { .. }),
                "score at WARN_THRESHOLD should produce Warn verdict, got: {verdict:?}"
            );
        }

        #[test]
        fn returns_flag_at_flag_threshold() {
            let mut d = Detectors::new();
            d.apply_violation_score("p1", FLAG_THRESHOLD);

            let verdict = d.worst_verdict_for_score("p1", "cheating");

            assert!(
                matches!(verdict, AnticheatVerdict::FlagPlayer { .. }),
                "score at FLAG_THRESHOLD should produce FlagPlayer verdict, got: {verdict:?}"
            );
        }

        #[test]
        fn returns_cancel_at_cancel_threshold() {
            let mut d = Detectors::new();
            d.apply_violation_score("p1", CANCEL_THRESHOLD);

            let verdict = d.worst_verdict_for_score("p1", "severe");

            assert!(
                matches!(verdict, AnticheatVerdict::CancelMatch { .. }),
                "score at CANCEL_THRESHOLD should produce CancelMatch verdict, got: {verdict:?}"
            );
        }

        #[test]
        fn caps_warn_at_three_warnings() {
            let mut d = Detectors::new();
            d.apply_violation_score("p1", WARN_THRESHOLD);

            // Issue 3 warnings — all should produce Warn
            for _ in 0..3 {
                let v = d.worst_verdict_for_score("p1", "detail");
                assert!(matches!(v, AnticheatVerdict::Warn { .. }));
            }

            // Fourth call at same score — warnings_issued == 3, should not Warn again
            let fourth = d.worst_verdict_for_score("p1", "detail");
            assert_eq!(
                fourth,
                AnticheatVerdict::Allow,
                "fourth warning at same score should be silenced"
            );
        }
    }

    // -----------------------------------------------------------------------
    // worse_verdict ordering
    // -----------------------------------------------------------------------

    mod worse_verdict {
        use super::*;

        #[test]
        fn cancel_beats_flag() {
            let a = AnticheatVerdict::FlagPlayer {
                player_id: "p1".into(),
                reason: "r".into(),
            };
            let b = AnticheatVerdict::CancelMatch {
                reason: "r".into(),
            };

            let result = worse_verdict(a, b);

            assert!(matches!(result, AnticheatVerdict::CancelMatch { .. }));
        }

        #[test]
        fn flag_beats_warn() {
            let a = AnticheatVerdict::Warn {
                player_id: "p1".into(),
                reason: "r".into(),
            };
            let b = AnticheatVerdict::FlagPlayer {
                player_id: "p1".into(),
                reason: "r".into(),
            };

            let result = worse_verdict(a, b);

            assert!(matches!(result, AnticheatVerdict::FlagPlayer { .. }));
        }

        #[test]
        fn allow_loses_to_warn() {
            let a = AnticheatVerdict::Allow;
            let b = AnticheatVerdict::Warn {
                player_id: "p1".into(),
                reason: "r".into(),
            };

            let result = worse_verdict(a, b);

            assert!(matches!(result, AnticheatVerdict::Warn { .. }));
        }

        #[test]
        fn equal_severity_keeps_first() {
            let a = AnticheatVerdict::Allow;
            let b = AnticheatVerdict::Allow;

            let result = worse_verdict(a, b);

            assert_eq!(result, AnticheatVerdict::Allow);
        }
    }
}
