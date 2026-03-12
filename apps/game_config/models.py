import uuid
from django.db import models
from django.core.exceptions import ValidationError


class GameSettings(models.Model):
    """Singleton model for global game settings. Only one instance allowed."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Match settings
    max_players = models.PositiveIntegerField(default=2, help_text='Maximum players per match')
    min_players = models.PositiveIntegerField(default=2, help_text='Minimum players to start match')
    
    # Timing
    tick_interval_ms = models.PositiveIntegerField(default=1000, help_text='Game tick interval in milliseconds')
    capital_selection_time_seconds = models.PositiveIntegerField(default=30, help_text='Time to select capital')
    match_duration_limit_minutes = models.PositiveIntegerField(default=60, help_text='Max match duration (0=unlimited)')
    
    # Unit generation
    base_unit_generation_rate = models.FloatField(default=1.0, help_text='Units generated per tick per region')
    capital_generation_bonus = models.FloatField(default=2.0, help_text='Multiplier for capital region')
    starting_currency = models.PositiveIntegerField(default=120, help_text='Starting strategic currency for each player')
    base_currency_per_tick = models.FloatField(default=2.0, help_text='Base currency generated per tick for each player')
    region_currency_per_tick = models.FloatField(default=0.35, help_text='Currency generated per owned region each tick')
    
    # Combat
    attacker_advantage = models.FloatField(default=0.0, help_text='Bonus for attacker (e.g. 0.1 = 10%)')
    defender_advantage = models.FloatField(default=0.1, help_text='Bonus for defender (e.g. 0.1 = 10%)')
    combat_randomness = models.FloatField(default=0.2, help_text='Random factor in combat (0-1)')
    
    # Starting conditions
    starting_units = models.PositiveIntegerField(default=10, help_text='Units in capital at start')
    starting_regions = models.PositiveIntegerField(default=1, help_text='Number of starting regions')
    neutral_region_units = models.PositiveIntegerField(
        default=3, help_text='Garrison units in unowned (neutral) regions'
    )
    
    # ELO
    elo_k_factor = models.PositiveIntegerField(default=32, help_text='K-factor for ELO calculation')
    
    class Meta:
        verbose_name = 'Game Settings'
        verbose_name_plural = 'Game Settings'

    def __str__(self):
        return 'Game Settings'

    def save(self, *args, **kwargs):
        if not self.pk and GameSettings.objects.exists():
            raise ValidationError('Only one GameSettings instance is allowed.')
        super().save(*args, **kwargs)

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=cls.objects.first().pk if cls.objects.exists() else None)
        return obj


class MovementType(models.TextChoices):
    LAND = 'land', 'Land'
    SEA = 'sea', 'Sea'
    AIR = 'air', 'Air'


class BuildingType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    asset_key = models.SlugField(max_length=100, blank=True, default='')
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default='🏗️')
    
    # Costs & timing
    cost = models.PositiveIntegerField(default=50, help_text='Unit cost to build')
    currency_cost = models.PositiveIntegerField(default=50, help_text='Currency cost to build')
    build_time_ticks = models.PositiveIntegerField(default=10, help_text='Ticks to complete building')
    
    # Constraints
    max_per_region = models.PositiveIntegerField(default=1, help_text='Max buildings of this type per region')
    requires_coastal = models.BooleanField(default=False, help_text='Only buildable in coastal regions')
    
    # Passive bonuses
    defense_bonus = models.FloatField(default=0.0, help_text='Defense bonus for region (e.g. 0.2 = 20%)')
    vision_range = models.PositiveIntegerField(default=0, help_text='Extra vision range in regions')
    unit_generation_bonus = models.FloatField(default=0.0, help_text='Extra units generated per tick')
    currency_generation_bonus = models.FloatField(default=0.0, help_text='Extra currency generated per tick by the region')
    
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class UnitType(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    asset_key = models.SlugField(max_length=100, blank=True, default='')
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default='⚔️')
    
    # Stats
    attack = models.FloatField(default=1.0)
    defense = models.FloatField(default=1.0)
    speed = models.PositiveIntegerField(default=1, help_text='Regions moved per tick')
    attack_range = models.PositiveIntegerField(default=1, help_text='Attack range in regions')
    sea_range = models.PositiveIntegerField(
        default=0,
        help_text='Sea distance score for maritime reach on custom maps (0 = disabled)'
    )
    sea_hop_distance_km = models.PositiveIntegerField(
        default=0,
        help_text='Max maritime hop distance in km for sea units (0 = use global fallback)'
    )
    
    # Production
    produced_by = models.ForeignKey(
        BuildingType, on_delete=models.CASCADE, related_name='unit_types',
        null=True, blank=True, help_text='Building required to produce this unit (null=default unit)'
    )
    production_cost = models.PositiveIntegerField(default=5, help_text='Unit cost to produce')
    production_time_ticks = models.PositiveIntegerField(default=5, help_text='Ticks to produce')
    manpower_cost = models.PositiveIntegerField(default=1, help_text='How many base units are consumed to produce one token of this unit')
    
    # Type
    movement_type = models.CharField(max_length=10, choices=MovementType.choices, default=MovementType.LAND)
    
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'name']

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
    max_players = models.PositiveIntegerField(default=2, help_text='Maximum players per match')
    min_players = models.PositiveIntegerField(default=2, help_text='Minimum players to start match')

    # Timing
    tick_interval_ms = models.PositiveIntegerField(default=1000, help_text='Game tick interval in milliseconds')
    capital_selection_time_seconds = models.PositiveIntegerField(default=30, help_text='Time to select capital')
    match_duration_limit_minutes = models.PositiveIntegerField(default=60, help_text='Max match duration (0=unlimited)')

    # Unit generation
    base_unit_generation_rate = models.FloatField(default=1.0, help_text='Units generated per tick per region')
    capital_generation_bonus = models.FloatField(default=2.0, help_text='Multiplier for capital region')
    starting_currency = models.PositiveIntegerField(default=120, help_text='Starting strategic currency for each player')
    base_currency_per_tick = models.FloatField(default=2.0, help_text='Base currency generated per tick for each player')
    region_currency_per_tick = models.FloatField(default=0.35, help_text='Currency generated per owned region each tick')

    # Combat
    attacker_advantage = models.FloatField(default=0.0, help_text='Bonus for attacker (e.g. 0.1 = 10%)')
    defender_advantage = models.FloatField(default=0.1, help_text='Bonus for defender (e.g. 0.1 = 10%)')
    combat_randomness = models.FloatField(default=0.2, help_text='Random factor in combat (0-1)')

    # Starting conditions
    starting_units = models.PositiveIntegerField(default=10, help_text='Units in capital at start')
    starting_regions = models.PositiveIntegerField(default=1, help_text='Number of starting regions')
    neutral_region_units = models.PositiveIntegerField(
        default=3, help_text='Garrison units in unowned (neutral) regions'
    )

    # ELO
    elo_k_factor = models.PositiveIntegerField(default=32, help_text='K-factor for ELO calculation')

    # Map
    map_config = models.ForeignKey(
        'MapConfig', on_delete=models.PROTECT, related_name='game_modes',
        null=True, blank=True,
    )

    # Metadata
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False, help_text='Default game mode shown first')
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.is_default:
            GameMode.objects.filter(is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class MapConfig(models.Model):
    """Defines which regions are included in a map configuration."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    
    # Filter regions
    country_codes = models.JSONField(
        default=list, blank=True,
        help_text='List of ISO country codes to include. Empty = all countries.'
    )

    # Capital placement rules
    min_capital_distance = models.PositiveIntegerField(
        default=3,
        help_text='Minimum hop distance between starting capitals (0 = no restriction).'
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
