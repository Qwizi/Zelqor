import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

VALID_EVENTS = [
    "match.started",
    "match.finished",
    "player.elo_changed",
    "server.online",
    "server.offline",
    "server.match_started",
    "server.match_finished",
    "plugin.installed",
    "plugin.uninstalled",
    "plugin.updated",
    "server.player_joined",
    "server.player_left",
    "server.game_mode_changed",
]

VALID_SCOPES = [
    "matches:read",
    "leaderboard:read",
    "players:read",
    "config:read",
    "webhooks:manage",
    "user:profile",
    "server:connect",
    "plugins:manage",
    "plugins:install",
    "server:admin",
    "game_modes:manage",
]

PLUGIN_CATEGORIES = [
    ("gameplay", "Gameplay"),
    ("economy", "Economy"),
    ("combat", "Combat"),
    ("admin", "Administration"),
    ("chat", "Chat & Communication"),
    ("anticheat", "Anti-Cheat"),
    ("cosmetic", "Cosmetics & Visual"),
    ("stats", "Statistics & Analytics"),
    ("moderation", "Moderation"),
    ("other", "Other"),
]

VALID_HOOKS = [
    "on_tick",
    "on_player_action",
    "on_combat_resolve",
    "on_match_start",
    "on_match_end",
    "on_player_join",
    "on_player_leave",
    "on_economy_tick",
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
    "on_player_eliminate",
    "on_energy_spend",
    "on_config_reload",
    "on_vote_start",
    "on_vote_end",
]


class DeveloperApp(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default="")
    client_id = models.CharField(max_length=64, unique=True, editable=False)
    client_secret_hash = models.CharField(max_length=128, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="developer_apps",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.client_id:
            self.client_id = "zq_" + secrets.token_hex(16)
        super().save(*args, **kwargs)

    @classmethod
    def generate_secret(cls) -> tuple[str, str]:
        raw_secret = secrets.token_urlsafe(48)
        secret_hash = hashlib.sha256(raw_secret.encode()).hexdigest()
        return raw_secret, secret_hash

    def __str__(self):
        return self.name

    # ------------------------------------------------------------------
    # First-party CLI app (singleton)
    # ------------------------------------------------------------------

    CLI_CLIENT_ID = "zq_cli"

    @classmethod
    def get_cli_app(cls) -> "DeveloperApp":
        """Return the built-in Zelqor CLI app, creating it on first call."""
        from apps.accounts.models import User

        app, created = cls.objects.get_or_create(
            client_id=cls.CLI_CLIENT_ID,
            defaults={
                "name": "Zelqor CLI",
                "description": "Built-in first-party CLI application.",
                "client_secret_hash": "cli-no-secret",
                "owner": User.objects.filter(is_superuser=True).first() or User.objects.first(),
                "is_active": True,
            },
        )
        return app


class APIKey(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(
        DeveloperApp,
        on_delete=models.CASCADE,
        related_name="api_keys",
    )
    key_hash = models.CharField(max_length=128, unique=True, db_index=True)
    prefix = models.CharField(max_length=12)
    scopes = models.JSONField(default=list)
    rate_limit = models.PositiveIntegerField(default=1000)
    is_active = models.BooleanField(default=True)
    last_used = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @classmethod
    def generate_key(cls) -> tuple[str, str, str]:
        raw_key = "zq_" + secrets.token_urlsafe(48)
        prefix = raw_key[:12]
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        return raw_key, prefix, key_hash

    def __str__(self):
        return f"{self.prefix}... ({self.app.name})"


class Webhook(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(
        DeveloperApp,
        on_delete=models.CASCADE,
        related_name="webhooks",
    )
    url = models.URLField(max_length=500)
    secret = models.CharField(max_length=128, editable=False)
    events = models.JSONField(default=list)
    is_active = models.BooleanField(default=True)
    failure_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def max_failures(self):
        from apps.game_config.modules import get_module_config

        return get_module_config("developers", "max_webhook_failures", 10)

    def save(self, *args, **kwargs):
        if not self.secret:
            self.secret = secrets.token_hex(32)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.app.name} -> {self.url}"


class WebhookDelivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    webhook = models.ForeignKey(
        Webhook,
        on_delete=models.CASCADE,
        related_name="deliveries",
    )
    event = models.CharField(max_length=100)
    payload = models.JSONField()
    response_status = models.PositiveIntegerField(null=True, blank=True)
    response_body = models.TextField(blank=True, default="")
    success = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event} -> {self.webhook} ({'ok' if self.success else 'fail'})"


class OAuthAuthorizationCode(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(
        DeveloperApp,
        on_delete=models.CASCADE,
        related_name="auth_codes",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
    )
    code = models.CharField(max_length=128, unique=True, db_index=True)
    redirect_uri = models.URLField(max_length=500)
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = secrets.token_urlsafe(48)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(minutes=10)
        super().save(*args, **kwargs)

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    def __str__(self):
        return f"AuthCode({self.app.name}, {self.user}, used={self.used})"


class OAuthAccessToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(
        DeveloperApp,
        on_delete=models.CASCADE,
        related_name="oauth_tokens",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
    )
    access_token = models.CharField(max_length=128, unique=True, db_index=True)
    refresh_token = models.CharField(max_length=128, unique=True, db_index=True)
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField()
    is_revoked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.access_token:
            self.access_token = secrets.token_urlsafe(48)
        if not self.refresh_token:
            self.refresh_token = secrets.token_urlsafe(48)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=1)
        super().save(*args, **kwargs)

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    def __str__(self):
        return f"AccessToken({self.app.name}, {self.user}, revoked={self.is_revoked})"


class DeviceAuthorizationCode(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(DeveloperApp, on_delete=models.CASCADE, related_name="device_codes")
    device_code = models.CharField(max_length=64, unique=True, db_index=True)
    user_code = models.CharField(max_length=10, unique=True, db_index=True)
    scopes = models.JSONField(default=list)
    is_authorized = models.BooleanField(default=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="device_authorizations",
    )
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    def __str__(self):
        return f"DeviceCode({self.app.name}, {self.user_code}, authorized={self.is_authorized})"


class CommunityServer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(DeveloperApp, on_delete=models.CASCADE, related_name="servers")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    region = models.CharField(max_length=50, db_index=True)
    max_players = models.PositiveIntegerField(default=100)
    is_public = models.BooleanField(default=True)
    status = models.CharField(
        max_length=20,
        choices=[("online", "Online"), ("offline", "Offline"), ("maintenance", "Maintenance")],
        default="offline",
    )
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    server_version = models.CharField(max_length=50, blank=True)
    custom_config = models.JSONField(default=dict, blank=True)
    allowed_plugins = models.JSONField(default=list, blank=True)
    is_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Multi-match support
    max_concurrent_matches = models.PositiveIntegerField(
        default=5, help_text="Maximum matches running simultaneously on this server"
    )
    current_match_count = models.PositiveIntegerField(default=0)

    # Player tracking
    current_player_count = models.PositiveIntegerField(default=0)

    # Default game mode for this server
    default_game_mode = models.ForeignKey(
        "game_config.GameMode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="default_for_servers",
    )

    # Allowed game modes (empty = all official modes allowed)
    allowed_game_modes = models.ManyToManyField(
        "game_config.GameMode",
        blank=True,
        related_name="allowed_on_servers",
    )

    # Server-level configuration overrides
    motd = models.TextField(blank=True, help_text="Message of the day shown to players on join")
    password_hash = models.CharField(max_length=128, blank=True, help_text="Empty = no password required")
    tags = models.JSONField(
        default=list, blank=True, help_text='Server tags for filtering, e.g. ["competitive", "casual"]'
    )

    # Networking
    connect_url = models.URLField(max_length=500, blank=True, help_text="WebSocket URL for direct connection")

    # Match configuration
    auto_start_match = models.BooleanField(default=True, help_text="Auto-start match when enough players join")
    min_players_to_start = models.PositiveIntegerField(default=2)
    match_start_countdown_seconds = models.PositiveIntegerField(default=30)
    allow_spectators = models.BooleanField(default=True)
    max_spectators = models.PositiveIntegerField(default=50)

    # Custom game modes created specifically for this server
    allow_custom_game_modes = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.region})"

    @property
    def has_capacity(self):
        return self.current_match_count < self.max_concurrent_matches

    @property
    def player_slots_available(self):
        return self.max_players - self.current_player_count


class Plugin(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(DeveloperApp, on_delete=models.CASCADE, related_name="plugins")
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    long_description = models.TextField(blank=True, help_text="Full markdown description for marketplace page")
    version = models.CharField(max_length=50)
    wasm_blob = models.FileField(upload_to="plugins/", blank=True)
    wasm_hash = models.CharField(max_length=128, blank=True)
    hooks = models.JSONField(default=list)
    is_published = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=False)
    download_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Marketplace fields
    category = models.CharField(max_length=30, choices=PLUGIN_CATEGORIES, default="other")
    icon = models.ImageField(upload_to="plugins/icons/", blank=True)
    banner = models.ImageField(upload_to="plugins/banners/", blank=True)
    homepage_url = models.URLField(max_length=500, blank=True)
    source_url = models.URLField(max_length=500, blank=True)
    tags = models.JSONField(default=list, blank=True)
    min_engine_version = models.CharField(max_length=50, blank=True)
    license = models.CharField(max_length=100, blank=True, default="MIT")

    # Stats
    install_count = models.PositiveIntegerField(default=0)
    rating_sum = models.PositiveIntegerField(default=0)
    rating_count = models.PositiveIntegerField(default=0)
    is_featured = models.BooleanField(default=False)
    is_deprecated = models.BooleanField(default=False)
    deprecation_message = models.TextField(blank=True)

    # Default config schema (JSON Schema) that servers can override
    config_schema = models.JSONField(default=dict, blank=True, help_text="JSON Schema for plugin configuration")
    default_config = models.JSONField(default=dict, blank=True, help_text="Default configuration values")

    # Permissions required by this plugin
    required_permissions = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} v{self.version}"

    @property
    def average_rating(self):
        if self.rating_count == 0:
            return 0.0
        return round(self.rating_sum / self.rating_count, 1)


class PluginVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plugin = models.ForeignKey(Plugin, on_delete=models.CASCADE, related_name="versions")
    version = models.CharField(max_length=50)
    wasm_blob = models.FileField(upload_to="plugins/versions/")
    wasm_hash = models.CharField(max_length=128)
    changelog = models.TextField(blank=True)
    min_engine_version = models.CharField(max_length=50, blank=True)
    is_yanked = models.BooleanField(default=False, help_text="Yanked versions cannot be installed")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("plugin", "version")]

    def __str__(self):
        return f"{self.plugin.name} v{self.version}"


class PluginDependency(models.Model):
    """Dependency between plugins — like package.json dependencies."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plugin = models.ForeignKey(Plugin, on_delete=models.CASCADE, related_name="dependencies")
    depends_on = models.ForeignKey(Plugin, on_delete=models.CASCADE, related_name="dependents")
    version_constraint = models.CharField(
        max_length=100, default="*", help_text='SemVer constraint, e.g. ">=1.0.0", "^2.0", "~1.2"'
    )
    is_optional = models.BooleanField(default=False)

    class Meta:
        unique_together = [("plugin", "depends_on")]
        ordering = ["plugin", "depends_on"]

    def __str__(self):
        opt = " (optional)" if self.is_optional else ""
        return f"{self.plugin.slug} -> {self.depends_on.slug} {self.version_constraint}{opt}"


class PluginReview(models.Model):
    """User reviews for plugins in the marketplace."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plugin = models.ForeignKey(Plugin, on_delete=models.CASCADE, related_name="reviews")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="plugin_reviews")
    rating = models.PositiveSmallIntegerField(help_text="Rating 1-5")
    title = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("plugin", "user")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} -> {self.plugin.slug}: {self.rating}/5"

    def save(self, *args, **kwargs):
        is_new = self._state.adding
        old_rating = None
        if not is_new:
            old_obj = PluginReview.objects.filter(pk=self.pk).first()
            if old_obj:
                old_rating = old_obj.rating
        super().save(*args, **kwargs)
        # Update plugin rating aggregates
        if is_new:
            Plugin.objects.filter(pk=self.plugin_id).update(
                rating_sum=models.F("rating_sum") + self.rating,
                rating_count=models.F("rating_count") + 1,
            )
        elif old_rating is not None and old_rating != self.rating:
            Plugin.objects.filter(pk=self.plugin_id).update(
                rating_sum=models.F("rating_sum") - old_rating + self.rating,
            )


class ServerPlugin(models.Model):
    """A plugin installed on a community server — with per-server config."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey(CommunityServer, on_delete=models.CASCADE, related_name="installed_plugins")
    plugin = models.ForeignKey(Plugin, on_delete=models.CASCADE, related_name="server_installations")
    plugin_version = models.ForeignKey(PluginVersion, on_delete=models.SET_NULL, null=True, blank=True)
    config = models.JSONField(default=dict, blank=True, help_text="Server-specific plugin configuration overrides")
    is_enabled = models.BooleanField(default=True)
    priority = models.IntegerField(default=0, help_text="Load order priority (lower = loaded first)")
    installed_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("server", "plugin")]
        ordering = ["priority", "installed_at"]

    def __str__(self):
        status = "enabled" if self.is_enabled else "disabled"
        return f"{self.plugin.slug} on {self.server.name} ({status})"


class CustomGameMode(models.Model):
    """Community-created game mode tied to a server."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey(CommunityServer, on_delete=models.CASCADE, related_name="custom_game_modes")
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_game_modes")
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=100)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=10, blank=True, help_text="Emoji icon for the game mode")

    # Base game mode to inherit settings from (optional)
    base_game_mode = models.ForeignKey(
        "game_config.GameMode",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="derived_custom_modes",
    )

    # Overrides as JSON — only changed fields
    config_overrides = models.JSONField(
        default=dict,
        blank=True,
        help_text='JSON overrides for GameMode fields, e.g. {"max_players": 8, "tick_interval_ms": 500}',
    )

    # Required plugins for this game mode
    required_plugins = models.ManyToManyField(Plugin, blank=True, related_name="required_by_game_modes")

    is_public = models.BooleanField(default=True, help_text="Visible in server browser")
    is_active = models.BooleanField(default=True)
    play_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("server", "slug")]
        ordering = ["-play_count"]

    def __str__(self):
        return f"{self.name} ({self.server.name})"


class ServerPlayerSession(models.Model):
    """Tracks a player's session on a community server."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    server = models.ForeignKey(CommunityServer, on_delete=models.CASCADE, related_name="player_sessions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="server_sessions")
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-joined_at"]

    def __str__(self):
        return f"{self.user} on {self.server.name}"
