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
            self.client_id = "ml_" + secrets.token_hex(16)
        super().save(*args, **kwargs)

    @classmethod
    def generate_secret(cls) -> tuple[str, str]:
        raw_secret = secrets.token_urlsafe(48)
        secret_hash = hashlib.sha256(raw_secret.encode()).hexdigest()
        return raw_secret, secret_hash

    def __str__(self):
        return self.name


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
        raw_key = "ml_" + secrets.token_urlsafe(48)
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

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.region})"


class Plugin(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(DeveloperApp, on_delete=models.CASCADE, related_name="plugins")
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    version = models.CharField(max_length=50)
    wasm_blob = models.FileField(upload_to="plugins/", blank=True)
    wasm_hash = models.CharField(max_length=128, blank=True)
    hooks = models.JSONField(default=list)
    is_published = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=False)
    download_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} v{self.version}"


class PluginVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plugin = models.ForeignKey(Plugin, on_delete=models.CASCADE, related_name="versions")
    version = models.CharField(max_length=50)
    wasm_blob = models.FileField(upload_to="plugins/versions/")
    wasm_hash = models.CharField(max_length=128)
    changelog = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("plugin", "version")]

    def __str__(self):
        return f"{self.plugin.name} v{self.version}"
