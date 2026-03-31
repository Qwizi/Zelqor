from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from apps.developers.models import (
    APIKey,
    CommunityServer,
    CustomGameMode,
    DeveloperApp,
    OAuthAccessToken,
    OAuthAuthorizationCode,
    Plugin,
    PluginDependency,
    PluginReview,
    PluginVersion,
    ServerPlugin,
    ServerPlayerSession,
    Webhook,
    WebhookDelivery,
)


# ── Inlines (must be defined before the admin classes that use them) ──


class WebhookDeliveryInline(TabularInline):
    model = WebhookDelivery
    extra = 0
    max_num = 20
    readonly_fields = ("id", "event", "payload", "response_status", "response_body", "success", "created_at")


class PluginVersionInline(TabularInline):
    model = PluginVersion
    extra = 0
    max_num = 20
    readonly_fields = ("id", "version", "wasm_hash", "changelog", "created_at")


class PluginDependencyInline(TabularInline):
    model = PluginDependency
    fk_name = "plugin"
    extra = 0
    max_num = 20
    autocomplete_fields = ("depends_on",)


class PluginReviewInline(TabularInline):
    model = PluginReview
    extra = 0
    max_num = 10
    readonly_fields = ("id", "user", "rating", "title", "body", "created_at")


class ServerPluginInline(TabularInline):
    model = ServerPlugin
    extra = 0
    max_num = 50
    autocomplete_fields = ("plugin",)
    readonly_fields = ("installed_at",)


class CustomGameModeInline(TabularInline):
    model = CustomGameMode
    extra = 0
    max_num = 20
    readonly_fields = ("id", "created_at")


# ── Admin classes ──


@admin.register(DeveloperApp)
class DeveloperAppAdmin(ModelAdmin):
    list_display = ("name", "owner", "client_id", "display_active", "created_at")
    list_filter = ("is_active",)
    list_fullwidth = True
    search_fields = ("name", "owner__username")
    readonly_fields = ("id", "client_id", "client_secret_hash", "created_at")

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(APIKey)
class APIKeyAdmin(ModelAdmin):
    list_display = ("prefix", "app", "display_active", "rate_limit", "last_used", "created_at")
    list_filter = ("is_active",)
    list_fullwidth = True
    readonly_fields = ("id", "key_hash", "prefix", "created_at")

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(Webhook)
class WebhookAdmin(ModelAdmin):
    list_display = ("app", "url", "display_active", "failure_count", "created_at")
    list_filter = ("is_active",)
    list_fullwidth = True
    readonly_fields = ("id", "secret", "created_at")
    inlines = [WebhookDeliveryInline]

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(ModelAdmin):
    list_display = ("webhook", "event", "display_success", "response_status", "created_at")
    list_filter = ("success", "event")
    list_filter_submit = True
    list_fullwidth = True
    readonly_fields = ("id", "webhook", "event", "payload", "response_status", "response_body", "success", "created_at")

    @display(description="Success", label=True)
    def display_success(self, obj):
        return "SUCCESS" if obj.success else "FAILED"


@admin.register(CommunityServer)
class CommunityServerAdmin(ModelAdmin):
    list_display = (
        "name",
        "app",
        "region",
        "display_status",
        "is_public",
        "is_verified",
        "current_player_count",
        "current_match_count",
        "max_concurrent_matches",
        "last_heartbeat",
        "created_at",
    )
    list_filter = ("status", "is_public", "is_verified", "region", "allow_custom_game_modes")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "app__name", "region")
    readonly_fields = ("id", "current_player_count", "current_match_count", "created_at", "updated_at")
    inlines = [ServerPluginInline, CustomGameModeInline]

    @display(description="Status", label=True)
    def display_status(self, obj):
        return obj.status.upper()


@admin.register(Plugin)
class PluginAdmin(ModelAdmin):
    list_display = (
        "name",
        "app",
        "slug",
        "version",
        "category",
        "display_published",
        "display_approved",
        "is_featured",
        "download_count",
        "install_count",
        "created_at",
    )
    list_filter = ("is_published", "is_approved", "is_featured", "is_deprecated", "category")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "slug", "app__name")
    readonly_fields = ("id", "wasm_hash", "download_count", "install_count", "rating_sum", "rating_count", "created_at", "updated_at")
    inlines = [PluginVersionInline, PluginDependencyInline, PluginReviewInline]

    @display(description="Published", label=True)
    def display_published(self, obj):
        return "PUBLISHED" if obj.is_published else "DRAFT"

    @display(description="Approved", label=True)
    def display_approved(self, obj):
        return "APPROVED" if obj.is_approved else "PENDING"


@admin.register(PluginVersion)
class PluginVersionAdmin(ModelAdmin):
    list_display = ("plugin", "version", "wasm_hash", "is_yanked", "created_at")
    list_filter = ("is_yanked",)
    list_fullwidth = True
    readonly_fields = ("id", "wasm_hash", "created_at")
    search_fields = ("plugin__name", "version")


@admin.register(PluginDependency)
class PluginDependencyAdmin(ModelAdmin):
    list_display = ("plugin", "depends_on", "version_constraint", "is_optional")
    list_fullwidth = True
    search_fields = ("plugin__name", "depends_on__name")


@admin.register(PluginReview)
class PluginReviewAdmin(ModelAdmin):
    list_display = ("plugin", "user", "rating", "title", "created_at")
    list_filter = ("rating",)
    list_fullwidth = True
    search_fields = ("plugin__name", "user__username")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(ServerPlugin)
class ServerPluginAdmin(ModelAdmin):
    list_display = ("server", "plugin", "display_enabled", "priority", "installed_at")
    list_filter = ("is_enabled",)
    list_fullwidth = True
    search_fields = ("server__name", "plugin__name")
    readonly_fields = ("id", "installed_at", "updated_at")

    @display(description="Enabled", label=True)
    def display_enabled(self, obj):
        return "ENABLED" if obj.is_enabled else "DISABLED"


@admin.register(CustomGameMode)
class CustomGameModeAdmin(ModelAdmin):
    list_display = ("name", "server", "creator", "display_active", "is_public", "play_count", "created_at")
    list_filter = ("is_active", "is_public")
    list_fullwidth = True
    search_fields = ("name", "server__name", "creator__username")
    readonly_fields = ("id", "play_count", "created_at", "updated_at")

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(ServerPlayerSession)
class ServerPlayerSessionAdmin(ModelAdmin):
    list_display = ("server", "user", "display_active", "joined_at", "left_at")
    list_filter = ("is_active",)
    list_fullwidth = True
    search_fields = ("server__name", "user__username")
    readonly_fields = ("id", "joined_at")

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ONLINE" if obj.is_active else "LEFT"


@admin.register(OAuthAuthorizationCode)
class OAuthAuthorizationCodeAdmin(ModelAdmin):
    list_display = ("app", "user", "used", "expires_at", "created_at")
    list_filter = ("used",)
    list_fullwidth = True
    readonly_fields = ("id", "code", "created_at")
    search_fields = ("app__name", "user__username", "user__email")


@admin.register(OAuthAccessToken)
class OAuthAccessTokenAdmin(ModelAdmin):
    list_display = ("app", "user", "display_revoked", "expires_at", "created_at")
    list_filter = ("is_revoked",)
    list_fullwidth = True
    readonly_fields = ("id", "access_token", "refresh_token", "created_at")
    search_fields = ("app__name", "user__username", "user__email")

    @display(description="Status", label=True)
    def display_revoked(self, obj):
        return "REVOKED" if obj.is_revoked else "ACTIVE"
