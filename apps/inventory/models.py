import uuid

from django.conf import settings
from django.db import models


class CosmeticSlot(models.TextChoices):
    # Units
    UNIT_INFANTRY = "unit_infantry", "Skin: Piechota"
    UNIT_TANK = "unit_tank", "Skin: Czołg"
    UNIT_SHIP = "unit_ship", "Skin: Okręt"
    UNIT_FIGHTER = "unit_fighter", "Skin: Myśliwiec"

    # Buildings
    BUILDING_BARRACKS = "building_barracks", "Skin: Koszary"
    BUILDING_FACTORY = "building_factory", "Skin: Fabryka"
    BUILDING_TOWER = "building_tower", "Skin: Wieża"
    BUILDING_PORT = "building_port", "Skin: Port"
    BUILDING_CARRIER = "building_carrier", "Skin: Lotniskowiec"
    BUILDING_RADAR = "building_radar", "Skin: Elektrownia"

    # VFX Actions
    VFX_ATTACK = "vfx_attack", "VFX: Atak"
    VFX_MOVE = "vfx_move", "VFX: Ruch"
    VFX_NUKE = "vfx_nuke", "VFX: Nuke"
    VFX_CAPTURE = "vfx_capture", "VFX: Zdobycie"
    VFX_DEFEND = "vfx_defend", "VFX: Obrona"

    # VFX Special
    VFX_ELIMINATION = "vfx_elimination", "VFX: Eliminacja"
    VFX_VICTORY = "vfx_victory", "VFX: Zwycięstwo"

    # Abilities
    ABILITY_CONSCRIPTION = "ability_conscription", "Skin: Pobór"
    ABILITY_RECON = "ability_recon", "Skin: Wywiad"
    ABILITY_SHIELD = "ability_shield", "Skin: Tarcza"
    ABILITY_VIRUS = "ability_virus", "Skin: Wirus"
    ABILITY_NUKE = "ability_nuke", "Skin: Nuke"

    # Profile
    EMBLEM = "emblem", "Emblemat"
    PROFILE_FRAME = "profile_frame", "Ramka profilu"
    PLAYER_TITLE = "player_title", "Tytuł"
    FLAG = "flag", "Flaga"

    # Audio
    SOUND_ATTACK = "sound_attack", "Dźwięk: Atak"
    MUSIC_THEME = "music_theme", "Muzyka: Motyw"


class ItemCategory(models.Model):
    """Top-level item category (Materials, Blueprints, Abilities, Boosts, Crates, Keys, Cosmetics)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "item categories"
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class Item(models.Model):
    """Definition of an item type that can exist in the game."""

    class Rarity(models.TextChoices):
        COMMON = "common", "Common"
        UNCOMMON = "uncommon", "Uncommon"
        RARE = "rare", "Rare"
        EPIC = "epic", "Epic"
        LEGENDARY = "legendary", "Legendary"

    class ItemType(models.TextChoices):
        MATERIAL = "material", "Material"
        BLUEPRINT_BUILDING = "blueprint_building", "Blueprint: Building"
        BLUEPRINT_UNIT = "blueprint_unit", "Blueprint: Unit"
        TACTICAL_PACKAGE = "tactical_package", "Tactical Package"
        BOOST = "boost", "Boost"
        CRATE = "crate", "Crate"
        KEY = "key", "Key"
        COSMETIC = "cosmetic", "Cosmetic"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    category = models.ForeignKey(ItemCategory, on_delete=models.CASCADE, related_name="items")
    item_type = models.CharField(max_length=30, choices=ItemType.choices)
    rarity = models.CharField(max_length=20, choices=Rarity.choices, default=Rarity.COMMON)
    level = models.PositiveIntegerField(default=1, help_text="Item level (1-3)")
    icon = models.CharField(max_length=100, blank=True)
    cosmetic_slot = models.CharField(
        max_length=30,
        choices=CosmeticSlot.choices,
        blank=True,
        help_text="Cosmetic slot for rendering (only for cosmetics)",
    )
    cosmetic_asset = models.ForeignKey(
        "assets.GameAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cosmetic_items",
        help_text="Asset file delivered by this cosmetic item",
    )
    cosmetic_params = models.JSONField(
        blank=True,
        null=True,
        help_text="For cosmetics: visual parameters JSON (trail, impact, icon, pulse config)",
    )
    is_stackable = models.BooleanField(default=True)
    is_tradeable = models.BooleanField(default=True)
    is_consumable = models.BooleanField(default=False, help_text="Destroyed on use (boosts, scrolls)")
    max_stack = models.PositiveIntegerField(default=999)
    base_value = models.PositiveIntegerField(default=0, help_text="Base gold value for bot pricing")

    # For crates: which items can drop from this crate
    crate_loot_table = models.JSONField(
        blank=True,
        null=True,
        help_text="For crates only: list of {item_slug, weight, min_qty, max_qty}",
    )
    # For keys: which crate this key opens
    opens_crate = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="opened_by_keys",
        help_text="For keys only: which crate item this key opens",
    )
    # For boosts: effect params applied during match
    boost_params = models.JSONField(
        blank=True,
        null=True,
        help_text="For boosts: {effect_type, value, duration_ticks}",
    )
    # For blueprints: reference to building/unit type
    blueprint_ref = models.CharField(
        max_length=100,
        blank=True,
        help_text="For blueprints: slug of the BuildingType or UnitType this unlocks",
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["category__order", "rarity", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_rarity_display()})"

    def save(self, *args, **kwargs):
        if self.item_type == self.ItemType.COSMETIC:
            self.is_stackable = False
        super().save(*args, **kwargs)


class UserInventory(models.Model):
    """A stack of items owned by a user."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="inventory")
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="in_inventories")
    quantity = models.PositiveIntegerField(default=1)
    acquired_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "item")
        ordering = ["item__category__order", "item__rarity", "item__name"]

    def __str__(self):
        return f"{self.user.username}: {self.item.name} x{self.quantity}"


class ItemDrop(models.Model):
    """Record of an item drop from a match."""

    class DropSource(models.TextChoices):
        MATCH_REWARD = "match_reward", "Match Reward"
        CRATE_OPEN = "crate_open", "Crate Open"
        CRAFTING = "crafting", "Crafting"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="item_drops")
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="drops")
    quantity = models.PositiveIntegerField(default=1)
    source = models.CharField(max_length=20, choices=DropSource.choices)
    match = models.ForeignKey(
        "matchmaking.Match",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="item_drops",
    )
    instance = models.ForeignKey(
        "ItemInstance",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drop_records",
        help_text="For non-stackable drops: the specific instance that dropped",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} received {self.item.name} x{self.quantity}"


class Wallet(models.Model):
    """Persistent gold wallet for a user (separate from in-match currency)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wallet")
    gold = models.PositiveIntegerField(default=0)
    total_earned = models.PositiveIntegerField(default=0)
    total_spent = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}: {self.gold} gold"


class Deck(models.Model):
    """A pre-match loadout of items (blueprints, boosts, ability scrolls)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="decks")
    name = models.CharField(max_length=50)
    is_default = models.BooleanField(default=False)
    is_editable = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default", "name"]

    def __str__(self):
        return f"{self.user.username}: {self.name}"

    def save(self, *args, **kwargs):
        if self.is_default:
            Deck.objects.filter(user=self.user, is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)


class DeckItem(models.Model):
    """An item slot within a deck."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="items")
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="in_decks")
    quantity = models.PositiveIntegerField(default=1)
    instance = models.ForeignKey(
        "ItemInstance",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="in_decks",
        help_text="For non-stackable items: the specific instance in this slot",
    )

    class Meta:
        unique_together = ("deck", "item")

    def __str__(self):
        return f"{self.deck.name}: {self.item.name} x{self.quantity}"


class ItemInstance(models.Model):
    """A unique instance of an item in the game world (CS2-style).

    Non-stackable items (blueprints, tactical packages, boosts, cosmetics)
    exist as individual instances with unique properties. Stackable items
    (materials, crates, keys) continue to use UserInventory with quantity.
    """

    class WearCondition(models.TextChoices):
        FACTORY_NEW = "factory_new", "Factory New"
        MINIMAL_WEAR = "minimal_wear", "Minimal Wear"
        FIELD_TESTED = "field_tested", "Field-Tested"
        WELL_WORN = "well_worn", "Well-Worn"
        BATTLE_SCARRED = "battle_scarred", "Battle-Scarred"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="instances")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="item_instances",
    )

    # CS2-like visual properties
    pattern_seed = models.PositiveIntegerField(default=0, help_text="0-999, determines visual variation")
    wear = models.FloatField(default=0.0, help_text="0.0 = Factory New, 1.0 = Battle-Scarred")

    # StatTrak
    stattrak = models.BooleanField(default=False)
    stattrak_matches = models.PositiveIntegerField(default=0)
    stattrak_kills = models.PositiveIntegerField(default=0, help_text="Regions conquered with this item equipped")
    stattrak_units_produced = models.PositiveIntegerField(default=0)

    # Personalization
    nametag = models.CharField(max_length=50, blank=True)

    # Provenance
    first_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="first_owned_instances",
    )
    crafted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="crafted_instances",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    dropped_from_match = models.ForeignKey(
        "matchmaking.Match",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dropped_instances",
    )

    class Meta:
        indexes = [
            models.Index(fields=["owner"]),
            models.Index(fields=["item"]),
            models.Index(fields=["owner", "item"]),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        tag = f' "{self.nametag}"' if self.nametag else ""
        st = " StatTrak\u2122" if self.stattrak else ""
        return f"{self.item.name}{st}{tag} ({self.wear_condition})"

    @property
    def wear_condition(self):
        if self.wear < 0.07:
            return self.WearCondition.FACTORY_NEW
        elif self.wear < 0.15:
            return self.WearCondition.MINIMAL_WEAR
        elif self.wear < 0.38:
            return self.WearCondition.FIELD_TESTED
        elif self.wear < 0.45:
            return self.WearCondition.WELL_WORN
        return self.WearCondition.BATTLE_SCARRED

    @property
    def is_rare_pattern(self):
        return self.pattern_seed < 10


class EquippedCosmetic(models.Model):
    """Tracks which cosmetic item a user has equipped in a given slot."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="equipped_cosmetics",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        limit_choices_to={"item_type": "cosmetic"},
        related_name="equipped_by",
    )
    slot = models.CharField(
        max_length=30,
        choices=CosmeticSlot.choices,
        help_text="Cosmetic slot for rendering",
    )
    equipped_at = models.DateTimeField(auto_now_add=True)
    instance = models.ForeignKey(
        "ItemInstance",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="equipped_as",
        help_text="The specific instance equipped in this slot",
    )

    class Meta:
        unique_together = ("user", "slot")
        ordering = ["slot"]

    def save(self, *args, **kwargs):
        if not self.slot:
            self.slot = self.item.cosmetic_slot
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user} - {self.slot}: {self.item}"
