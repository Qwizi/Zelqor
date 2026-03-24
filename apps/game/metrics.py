"""Prometheus metrics for game analytics and balance monitoring."""

from prometheus_client import Counter, Gauge, Histogram

# ── Match lifecycle ──────────────────────────────────────────────────

matches_started_total = Counter(
    'maplord_matches_started_total',
    'Total matches started',
    ['game_mode'],
)
matches_finished_total = Counter(
    'maplord_matches_finished_total',
    'Total matches finished',
    ['game_mode'],
)
match_duration_seconds = Histogram(
    'maplord_match_duration_seconds',
    'Match duration in seconds',
    buckets=[60, 120, 300, 600, 900, 1200, 1800, 3600],
)
active_matches = Gauge(
    'maplord_active_matches',
    'Currently active matches',
)

# ── ELO ──────────────────────────────────────────────────────────────

elo_change = Histogram(
    'maplord_elo_change',
    'ELO rating change per player per match',
    ['result'],  # "win", "loss"
    buckets=[-50, -30, -20, -10, -5, 0, 5, 10, 20, 30, 50],
)

# ── Economy ──────────────────────────────────────────────────────────

gold_awarded_total = Counter(
    'maplord_gold_awarded_total',
    'Total gold awarded to players',
    ['source'],  # "match_win", "match_loss"
)
gold_spent_total = Counter(
    'maplord_gold_spent_total',
    'Total gold spent by players',
    ['sink'],  # "marketplace_fee", "crafting"
)
marketplace_transactions_total = Counter(
    'maplord_marketplace_tx_total',
    'Total marketplace transactions completed',
)
marketplace_volume_gold = Counter(
    'maplord_marketplace_volume_gold_total',
    'Total gold volume traded on marketplace',
)

# ── Players ──────────────────────────────────────────────────────────

players_online = Gauge(
    'maplord_players_online',
    'Players currently online',
)
players_in_queue = Gauge(
    'maplord_players_in_queue',
    'Players currently in matchmaking queue',
)

# ── Items ────────────────────────────────────────────────────────────

item_drops_total = Counter(
    'maplord_item_drops_total',
    'Total items dropped from matches',
    ['rarity'],  # "common", "uncommon", "rare", "epic", "legendary"
)

# ── Player results (aggregated from match finalization) ──────────────

player_eliminations_total = Counter(
    'maplord_player_eliminations_total',
    'Total player eliminations',
    ['reason'],  # "capital_capture", "disconnect_timeout", "left_match"
)
