import uuid

from django.core.exceptions import ValidationError
from django.db import models


class GameSettings(models.Model):
    """Singleton model for global game settings. Only one instance allowed."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Match settings
    max_players = models.PositiveIntegerField(default=2, help_text="Maximum players per match")
    min_players = models.PositiveIntegerField(default=2, help_text="Minimum players to start match")

    # Timing
    tick_interval_ms = models.PositiveIntegerField(default=1000, help_text="Game tick interval in milliseconds")
    capital_selection_time_seconds = models.PositiveIntegerField(default=30, help_text="Time to select capital")
    match_duration_limit_minutes = models.PositiveIntegerField(default=60, help_text="Max match duration (0=unlimited)")

    # Unit generation
    base_unit_generation_rate = models.FloatField(default=1.0, help_text="Units generated per tick per region")
    capital_generation_bonus = models.FloatField(default=2.0, help_text="Multiplier for capital region")
    starting_energy = models.PositiveIntegerField(default=120, help_text="Starting energy for each player")
    base_energy_per_tick = models.FloatField(default=2.0, help_text="Base energy generated per tick for each player")
    region_energy_per_tick = models.FloatField(default=0.35, help_text="Energy generated per owned region each tick")

    # Combat
    attacker_advantage = models.FloatField(default=0.0, help_text="Bonus for attacker (e.g. 0.1 = 10%)")
    defender_advantage = models.FloatField(default=0.1, help_text="Bonus for defender (e.g. 0.1 = 10%)")
    combat_randomness = models.FloatField(default=0.2, help_text="Random factor in combat (0-1)")

    # Starting conditions
    starting_units = models.PositiveIntegerField(default=10, help_text="Units in capital at start")
    starting_regions = models.PositiveIntegerField(default=1, help_text="Number of starting regions")
    neutral_region_units = models.PositiveIntegerField(
        default=3, help_text="Garrison units in unowned (neutral) regions"
    )

    # Weather & day/night
    weather_enabled = models.BooleanField(default=True, help_text="Enable weather effects (rain, fog, storm)")
    day_night_enabled = models.BooleanField(default=True, help_text="Enable day/night cycle")

    # Weather gameplay modifiers
    night_defense_modifier = models.FloatField(default=1.15, help_text="Defense multiplier at night (e.g. 1.15 = +15%)")
    dawn_dusk_defense_modifier = models.FloatField(
        default=1.05, help_text="Defense multiplier at dawn/dusk (e.g. 1.05 = +5%)"
    )
    storm_randomness_modifier = models.FloatField(
        default=1.4, help_text="Combat randomness multiplier during storms (e.g. 1.4 = +40%)"
    )
    fog_randomness_modifier = models.FloatField(
        default=1.25, help_text="Combat randomness multiplier during fog (e.g. 1.25 = +25%)"
    )
    rain_randomness_modifier = models.FloatField(
        default=1.1, help_text="Combat randomness multiplier during rain (e.g. 1.1 = +10%)"
    )
    storm_energy_modifier = models.FloatField(
        default=0.85, help_text="Energy generation multiplier during storms (e.g. 0.85 = -15%)"
    )
    rain_energy_modifier = models.FloatField(
        default=0.95, help_text="Energy generation multiplier during rain (e.g. 0.95 = -5%)"
    )
    storm_unit_gen_modifier = models.FloatField(
        default=0.90, help_text="Unit generation multiplier during storms (e.g. 0.90 = -10%)"
    )
    rain_unit_gen_modifier = models.FloatField(
        default=0.95, help_text="Unit generation multiplier during rain (e.g. 0.95 = -5%)"
    )

    # Gameplay limits
    disconnect_grace_seconds = models.PositiveIntegerField(
        default=180, help_text="Seconds before disconnected player is eliminated"
    )
    max_build_queue_per_region = models.PositiveIntegerField(
        default=3, help_text="Max simultaneous build orders per region"
    )
    max_unit_queue_per_region = models.PositiveIntegerField(
        default=4, help_text="Max simultaneous unit production orders per region"
    )
    casualty_factor = models.FloatField(default=0.5, help_text="Portion of power difference that kills units (0-1)")
    snapshot_interval_ticks = models.PositiveIntegerField(default=30, help_text="Save state snapshot every N ticks")

    # ELO
    elo_k_factor = models.PositiveIntegerField(default=32, help_text="K-factor for ELO calculation")

    # Diplomacy
    capital_protection_ticks = models.PositiveIntegerField(
        default=300, help_text="Ticks of capital immunity at game start (0=disabled, 300=5min at 1s/tick)"
    )
    nap_minimum_duration_ticks = models.PositiveIntegerField(
        default=300, help_text="Minimum non-aggression pact duration in ticks"
    )
    peace_cooldown_ticks = models.PositiveIntegerField(
        default=120, help_text="Cooldown ticks before peace can be re-proposed after rejection"
    )
    proposal_timeout_ticks = models.PositiveIntegerField(
        default=60, help_text="Ticks before a diplomacy proposal auto-expires (0=no timeout)"
    )
    diplomacy_enabled = models.BooleanField(
        default=True, help_text="Enable diplomacy system (wars, pacts, peace treaties)"
    )

    # Action Points
    max_action_points = models.IntegerField(default=15, help_text="Max AP pool per player")
    ap_regen_interval = models.IntegerField(default=2, help_text="Ticks between each +1 AP regeneration")
    ap_cost_attack = models.IntegerField(
        default=4, help_text="Max AP cost for attack/bombard/intercept (scaled by % units sent)"
    )
    ap_cost_move = models.IntegerField(default=1, help_text="AP cost for move")
    ap_cost_build = models.IntegerField(default=1, help_text="AP cost for build/upgrade")
    ap_cost_produce = models.IntegerField(default=0, help_text="AP cost for unit production")
    ap_cost_ability = models.IntegerField(default=3, help_text="AP cost for ability use")

    # Region Cooldowns
    region_attack_cooldown = models.IntegerField(
        default=0, help_text="Ticks before a region can attack again (0 = no cooldown)"
    )
    region_move_cooldown = models.IntegerField(default=2, help_text="Ticks before a region can move again")

    # Combat Fatigue
    fatigue_attack_modifier = models.FloatField(
        default=0.30, help_text="Power reduction after winning attack (e.g. 0.30 = 30%)"
    )
    fatigue_defense_modifier = models.FloatField(
        default=0.20, help_text="Power reduction after winning defense (e.g. 0.20 = 20%)"
    )
    fatigue_attack_ticks = models.IntegerField(default=5, help_text="Duration of attacker fatigue in ticks")
    fatigue_defense_ticks = models.IntegerField(default=3, help_text="Duration of defender fatigue in ticks")

    class Meta:
        verbose_name = "Game Settings"
        verbose_name_plural = "Game Settings"

    def __str__(self):
        return "Game Settings"

    def save(self, *args, **kwargs):
        if not self.pk and GameSettings.objects.exists():
            raise ValidationError("Only one GameSettings instance is allowed.")
        super().save(*args, **kwargs)
        from django.core.cache import cache

        cache.delete("game_settings_singleton")

    @classmethod
    def get(cls):
        from django.core.cache import cache

        obj = cache.get("game_settings_singleton")
        if obj is None:
            obj = cls.objects.first()
            if obj is None:
                obj = cls.objects.create()
            cache.set("game_settings_singleton", obj, timeout=60)
        return obj


class MovementType(models.TextChoices):
    LAND = "land", "Land"
    SEA = "sea", "Sea"
    AIR = "air", "Air"


class BuildingType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    asset_key = models.SlugField(max_length=100, blank=True, default="")
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default="🏗️")

    # Constraints
    max_per_region = models.PositiveIntegerField(default=1, help_text="Max buildings of this type per region")
    requires_coastal = models.BooleanField(default=False, help_text="Only buildable in coastal regions")

    # Passive bonuses
    defense_bonus = models.FloatField(default=0.0, help_text="Defense bonus for region (e.g. 0.2 = 20%)")
    vision_range = models.PositiveIntegerField(default=0, help_text="Extra vision range in regions")
    unit_generation_bonus = models.FloatField(default=0.0, help_text="Extra units generated per tick")
    energy_generation_bonus = models.FloatField(default=0.0, help_text="Extra energy generated per tick by the region")

    # Level system
    max_level = models.PositiveIntegerField(default=3, help_text="Maximum upgrade level (1-5)")
    level_stats = models.JSONField(
        default=dict,
        blank=True,
        help_text="Per-level stat overrides. Keys are level numbers as strings. "
        'Example: {"1": {"defense_bonus": 0.1}, "2": {"defense_bonus": 0.16}, "3": {"defense_bonus": 0.22}}. '
        "Supported keys: defense_bonus, vision_range, unit_generation_bonus, energy_generation_bonus, energy_cost, build_time_ticks",
    )

    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class UnitType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    asset_key = models.SlugField(max_length=100, blank=True, default="")
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default="⚔️")

    # Stats
    attack = models.FloatField(default=1.0)
    defense = models.FloatField(default=1.0)
    speed = models.PositiveIntegerField(default=1, help_text="Regions moved per tick")
    attack_range = models.PositiveIntegerField(default=1, help_text="Attack range in regions")
    sea_range = models.PositiveIntegerField(
        default=0, help_text="Sea distance score for maritime reach on custom maps (0 = disabled)"
    )
    sea_hop_distance_km = models.PositiveIntegerField(
        default=0, help_text="Max maritime hop distance in km for sea units (0 = use global fallback)"
    )

    # Production
    produced_by = models.ForeignKey(
        BuildingType,
        on_delete=models.CASCADE,
        related_name="unit_types",
        null=True,
        blank=True,
        help_text="Building required to produce this unit (null=default unit)",
    )

    # Type
    movement_type = models.CharField(max_length=10, choices=MovementType.choices, default=MovementType.LAND)

    # Level system
    max_level = models.PositiveIntegerField(default=1, help_text="Maximum upgrade level")
    level_stats = models.JSONField(
        default=dict,
        blank=True,
        help_text="Per-level stat overrides. Keys are level numbers as strings. "
        'Example: {"1": {"attack": 3.0, "defense": 2.5}, "2": {"attack": 4.0}}. '
        "Supported keys: attack, defense, speed, production_cost, production_time_ticks, manpower_cost",
    )

    # Advanced unit attributes
    is_stealth = models.BooleanField(default=False, help_text="Unit is invisible to enemies until it attacks")
    path_damage = models.FloatField(
        default=0.0, help_text="Fraction of damage dealt to provinces along flight path (bomber)"
    )
    aoe_damage = models.FloatField(
        default=0.0, help_text="Fraction of damage dealt to neighboring provinces of target (artillery)"
    )
    blockade_port = models.BooleanField(default=False, help_text="Blocks enemy port production when stationed nearby")
    intercept_air = models.BooleanField(
        default=False, help_text="Automatically intercepts enemy air units passing through"
    )
    can_station_anywhere = models.BooleanField(
        default=False, help_text="Does not require producer building to station in region"
    )
    lifetime_ticks = models.PositiveIntegerField(default=0, help_text="Auto-destruct after N ticks (0 = permanent)")
    combat_target = models.CharField(
        max_length=10,
        default="ground",
        choices=[("air", "Air"), ("ground", "Ground"), ("both", "Both")],
        help_text="What this unit targets in combat",
    )
    ticks_per_hop = models.PositiveIntegerField(
        default=0, help_text="Ticks per province hop for ground/sea units (0 = use legacy speed formula)"
    )
    air_speed_ticks_per_hop = models.PositiveIntegerField(
        default=0, help_text="Ticks per province hop for air transit (0 = use legacy speed formula)"
    )

    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_movement_type_display()})"

    @property
    def produced_by_slug(self):
        return self.produced_by.slug if self.produced_by_id else None


class GameMode(models.Model):
    """Defines a game mode with its own settings (e.g., Standard 2P, 3P, 4P, Custom)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(blank=True)

    # Match settings
    max_players = models.PositiveIntegerField(default=2, help_text="Maximum players per match")
    min_players = models.PositiveIntegerField(default=2, help_text="Minimum players to start match")

    # Timing
    tick_interval_ms = models.PositiveIntegerField(default=1000, help_text="Game tick interval in milliseconds")
    capital_selection_time_seconds = models.PositiveIntegerField(default=30, help_text="Time to select capital")
    match_duration_limit_minutes = models.PositiveIntegerField(default=60, help_text="Max match duration (0=unlimited)")

    # Unit generation
    base_unit_generation_rate = models.FloatField(default=1.0, help_text="Units generated per tick per region")
    capital_generation_bonus = models.FloatField(default=2.0, help_text="Multiplier for capital region")
    starting_energy = models.PositiveIntegerField(default=120, help_text="Starting energy for each player")
    base_energy_per_tick = models.FloatField(default=2.0, help_text="Base energy generated per tick for each player")
    region_energy_per_tick = models.FloatField(default=0.35, help_text="Energy generated per owned region each tick")

    # Combat
    attacker_advantage = models.FloatField(default=0.0, help_text="Bonus for attacker (e.g. 0.1 = 10%)")
    defender_advantage = models.FloatField(default=0.1, help_text="Bonus for defender (e.g. 0.1 = 10%)")
    combat_randomness = models.FloatField(default=0.2, help_text="Random factor in combat (0-1)")

    # Starting conditions
    starting_units = models.PositiveIntegerField(default=10, help_text="Units in capital at start")
    starting_regions = models.PositiveIntegerField(default=1, help_text="Number of starting regions")
    neutral_region_units = models.PositiveIntegerField(
        default=3, help_text="Garrison units in unowned (neutral) regions"
    )

    # Weather & day/night
    weather_enabled = models.BooleanField(default=True, help_text="Enable weather effects (rain, fog, storm)")
    day_night_enabled = models.BooleanField(default=True, help_text="Enable day/night cycle")

    # Weather gameplay modifiers
    night_defense_modifier = models.FloatField(default=1.15, help_text="Defense multiplier at night (e.g. 1.15 = +15%)")
    dawn_dusk_defense_modifier = models.FloatField(
        default=1.05, help_text="Defense multiplier at dawn/dusk (e.g. 1.05 = +5%)"
    )
    storm_randomness_modifier = models.FloatField(
        default=1.4, help_text="Combat randomness multiplier during storms (e.g. 1.4 = +40%)"
    )
    fog_randomness_modifier = models.FloatField(
        default=1.25, help_text="Combat randomness multiplier during fog (e.g. 1.25 = +25%)"
    )
    rain_randomness_modifier = models.FloatField(
        default=1.1, help_text="Combat randomness multiplier during rain (e.g. 1.1 = +10%)"
    )
    storm_energy_modifier = models.FloatField(
        default=0.85, help_text="Energy generation multiplier during storms (e.g. 0.85 = -15%)"
    )
    rain_energy_modifier = models.FloatField(
        default=0.95, help_text="Energy generation multiplier during rain (e.g. 0.95 = -5%)"
    )
    storm_unit_gen_modifier = models.FloatField(
        default=0.90, help_text="Unit generation multiplier during storms (e.g. 0.90 = -10%)"
    )
    rain_unit_gen_modifier = models.FloatField(
        default=0.95, help_text="Unit generation multiplier during rain (e.g. 0.95 = -5%)"
    )

    # Gameplay limits
    disconnect_grace_seconds = models.PositiveIntegerField(
        default=180, help_text="Seconds before disconnected player is eliminated"
    )
    max_build_queue_per_region = models.PositiveIntegerField(
        default=3, help_text="Max simultaneous build orders per region"
    )
    max_unit_queue_per_region = models.PositiveIntegerField(
        default=4, help_text="Max simultaneous unit production orders per region"
    )
    casualty_factor = models.FloatField(default=0.5, help_text="Portion of power difference that kills units (0-1)")
    snapshot_interval_ticks = models.PositiveIntegerField(default=30, help_text="Save state snapshot every N ticks")

    # ELO
    elo_k_factor = models.PositiveIntegerField(default=32, help_text="K-factor for ELO calculation")

    # Diplomacy
    capital_protection_ticks = models.PositiveIntegerField(
        default=300, help_text="Ticks of capital immunity at game start (0=disabled, 300=5min at 1s/tick)"
    )
    nap_minimum_duration_ticks = models.PositiveIntegerField(
        default=300, help_text="Minimum non-aggression pact duration in ticks"
    )
    peace_cooldown_ticks = models.PositiveIntegerField(
        default=120, help_text="Cooldown ticks before peace can be re-proposed after rejection"
    )
    proposal_timeout_ticks = models.PositiveIntegerField(
        default=60, help_text="Ticks before a diplomacy proposal auto-expires (0=no timeout)"
    )
    diplomacy_enabled = models.BooleanField(
        default=True, help_text="Enable diplomacy system (wars, pacts, peace treaties)"
    )

    # Action Points
    max_action_points = models.IntegerField(default=15, help_text="Max AP pool per player")
    ap_regen_interval = models.IntegerField(default=2, help_text="Ticks between each +1 AP regeneration")
    ap_cost_attack = models.IntegerField(
        default=4, help_text="Max AP cost for attack/bombard/intercept (scaled by % units sent)"
    )
    ap_cost_move = models.IntegerField(default=1, help_text="AP cost for move")
    ap_cost_build = models.IntegerField(default=1, help_text="AP cost for build/upgrade")
    ap_cost_produce = models.IntegerField(default=0, help_text="AP cost for unit production")
    ap_cost_ability = models.IntegerField(default=3, help_text="AP cost for ability use")

    # Region Cooldowns
    region_attack_cooldown = models.IntegerField(
        default=0, help_text="Ticks before a region can attack again (0 = no cooldown)"
    )
    region_move_cooldown = models.IntegerField(default=2, help_text="Ticks before a region can move again")

    # Combat Fatigue
    fatigue_attack_modifier = models.FloatField(
        default=0.30, help_text="Power reduction after winning attack (e.g. 0.30 = 30%)"
    )
    fatigue_defense_modifier = models.FloatField(
        default=0.20, help_text="Power reduction after winning defense (e.g. 0.20 = 20%)"
    )
    fatigue_attack_ticks = models.IntegerField(default=5, help_text="Duration of attacker fatigue in ticks")
    fatigue_defense_ticks = models.IntegerField(default=3, help_text="Duration of defender fatigue in ticks")

    # Map
    map_config = models.ForeignKey(
        "MapConfig",
        on_delete=models.PROTECT,
        related_name="game_modes",
        null=True,
        blank=True,
    )

    # Metadata
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False, help_text="Default game mode shown first")
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.is_default:
            GameMode.objects.filter(is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class TargetType(models.TextChoices):
    ENEMY = "enemy", "Enemy"
    OWN = "own", "Own"
    ANY = "any", "Any"


class AbilityType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    asset_key = models.SlugField(max_length=100, blank=True, default="")
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default="")
    sound_key = models.CharField(max_length=100, blank=True, default="")

    # Targeting
    target_type = models.CharField(max_length=10, choices=TargetType.choices, default=TargetType.ENEMY)
    range = models.PositiveIntegerField(default=1, help_text="Max hops from owned regions to target")

    # Costs & timing
    energy_cost = models.PositiveIntegerField(default=50, help_text="Energy cost to use")
    cooldown_ticks = models.PositiveIntegerField(default=60, help_text="Cooldown in ticks after use")

    # Instant effects
    damage = models.PositiveIntegerField(default=0, help_text="Instant damage (units killed)")

    # Persistent effects
    effect_duration_ticks = models.PositiveIntegerField(default=0, help_text="Duration for persistent effects")
    effect_params = models.JSONField(
        default=dict,
        blank=True,
        help_text="Per-ability params: production_reduction, unit_kill_percent, spread_range, collect_percent",
    )

    # Level system
    max_level = models.PositiveIntegerField(default=3, help_text="Maximum upgrade level (1-5)")
    level_stats = models.JSONField(
        default=dict,
        blank=True,
        help_text="Per-level stat overrides. Keys are level numbers as strings. "
        'Example: {"1": {"damage": 50}, "2": {"damage": 65, "cooldown_ticks": 50}, "3": {"damage": 80, "effect_duration_ticks": 25}}. '
        "Supported keys: energy_cost, cooldown_ticks, damage, effect_duration_ticks, range, effect_params",
    )

    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class MapConfig(models.Model):
    """Defines which regions are included in a map configuration."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)

    # Filter regions
    country_codes = models.JSONField(
        default=list, blank=True, help_text="List of ISO country codes to include. Empty = all countries."
    )

    # Capital placement rules
    min_capital_distance = models.PositiveIntegerField(
        default=3, help_text="Minimum hop distance between starting capitals (0 = no restriction)."
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ModuleType(models.TextChoices):
    SYSTEM = "system", "System"
    GAME = "game", "Game"


class SystemModule(models.Model):
    """
    Unified module system — both application-wide feature toggles (system)
    and per-match game modules (game).

    System modules gate backend API endpoints, frontend UI sections, and gateway features.
    Game modules configure per-match settings (weather, combat, economy, etc.)
    with override support via GameSettingsModuleOverride / GameModeModuleOverride.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default="")

    module_type = models.CharField(
        max_length=20,
        choices=ModuleType.choices,
        default=ModuleType.SYSTEM,
        help_text="System = app-wide feature toggle, Game = per-match configurable module",
    )

    enabled = models.BooleanField(default=True, help_text="Whether this module is currently active")
    config = models.JSONField(default=dict, blank=True, help_text="Module-specific configuration as JSON")
    config_schema = models.JSONField(
        default=list, blank=True, help_text="Describes available config fields for admin UI"
    )

    # Which layers this module affects
    affects_backend = models.BooleanField(default=True, help_text="Controls backend API endpoints")
    affects_frontend = models.BooleanField(default=True, help_text="Controls frontend UI sections")
    affects_gateway = models.BooleanField(default=False, help_text="Controls Rust gateway features")

    is_core = models.BooleanField(default=False, help_text="Core modules cannot be disabled (auth, config, geo)")
    order = models.PositiveIntegerField(default=0)

    # Game module fields (only used when module_type='game')
    default_enabled = models.BooleanField(default=True, help_text="Default enabled state for new matches")
    default_config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Default config parameters for game modules (merged with overrides per match)",
    )
    field_mapping = models.JSONField(
        default=dict,
        blank=True,
        help_text='Maps module to flat settings fields: {"enabled_field": "weather_enabled", "config_fields": {"key": "snapshot_field"}}',
    )

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        status = "ON" if self.enabled else "OFF"
        core = " [CORE]" if self.is_core else ""
        return f"{self.name} [{status}]{core}"

    def clean(self):
        if self.is_core and not self.enabled:
            raise ValidationError("Core modules cannot be disabled.")

    @classmethod
    def is_enabled(cls, slug: str) -> bool:
        """Check if a system module is enabled. Cached for 60 seconds."""
        from django.core.cache import cache

        cache_key = f"sysmodule:{slug}"
        result = cache.get(cache_key)
        if result is None:
            try:
                module = cls.objects.get(slug=slug)
                result = module.enabled
            except cls.DoesNotExist:
                # Unknown modules are considered enabled (fail-open for dev)
                result = True
            cache.set(cache_key, result, 60)
        return result

    @classmethod
    def get_all_states(cls) -> dict:
        """Return {slug: enabled} dict for all modules. Cached for 60 seconds."""
        from django.core.cache import cache

        cache_key = "sysmodules:all"
        result = cache.get(cache_key)
        if result is None:
            result = dict(cls.objects.values_list("slug", "enabled"))
            cache.set(cache_key, result, 60)
        return result

    @classmethod
    def invalidate_cache(cls):
        """Invalidate all system module caches."""
        from django.core.cache import cache

        for slug in cls.objects.values_list("slug", flat=True):
            cache.delete(f"sysmodule:{slug}")
            cache.delete(f"sysmodule_cfg:{slug}")
        cache.delete("sysmodules:all")
        cache.delete("sysmodules:full")

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        SystemModule.invalidate_cache()

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        SystemModule.invalidate_cache()


class GameSettingsModuleOverride(models.Model):
    """Per-module override for global GameSettings."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_settings = models.ForeignKey(GameSettings, on_delete=models.CASCADE, related_name="module_overrides")
    module = models.ForeignKey(SystemModule, on_delete=models.CASCADE, related_name="settings_overrides")
    enabled = models.BooleanField(default=True)
    config = models.JSONField(
        default=dict, blank=True, help_text="Override config values (merged with module defaults)"
    )

    class Meta:
        unique_together = ("game_settings", "module")
        ordering = ["module__order"]

    def __str__(self):
        status = "ON" if self.enabled else "OFF"
        return f"{self.module.name} [{status}]"


class GameModeModuleOverride(models.Model):
    """Per-module override for a GameMode."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_mode = models.ForeignKey(GameMode, on_delete=models.CASCADE, related_name="module_overrides")
    module = models.ForeignKey(SystemModule, on_delete=models.CASCADE, related_name="mode_overrides")
    enabled = models.BooleanField(default=True)
    config = models.JSONField(
        default=dict, blank=True, help_text="Override config values (merged with module defaults)"
    )

    class Meta:
        unique_together = ("game_mode", "module")
        ordering = ["module__order"]

    def __str__(self):
        status = "ON" if self.enabled else "OFF"
        return f"{self.module.name} [{status}]"
