import hashlib
import ipaddress
import socket
import uuid
from urllib.parse import urlparse

from django.core.cache import cache
from django.db import models as db_models
from django.http import Http404
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.developers.models import (
    PLUGIN_CATEGORIES,
    VALID_EVENTS,
    VALID_HOOKS,
    VALID_SCOPES,
    APIKey,
    CommunityServer,
    CustomGameMode,
    DeveloperApp,
    Plugin,
    PluginDependency,
    PluginReview,
    PluginVersion,
    ServerPlugin,
    Webhook,
    WebhookDelivery,
)
from apps.developers.schemas import (
    APIKeyCreatedSchema,
    APIKeyCreateSchema,
    APIKeyOutSchema,
    AvailableEventsSchema,
    AvailableHooksSchema,
    AvailableScopesSchema,
    CommunityServerCreateSchema,
    CommunityServerListSchema,
    CommunityServerOutSchema,
    CommunityServerUpdateSchema,
    CustomGameModeCreateSchema,
    CustomGameModeOutSchema,
    CustomGameModeUpdateSchema,
    DeveloperAppCreatedSchema,
    DeveloperAppCreateSchema,
    DeveloperAppOutSchema,
    DeveloperAppUpdateSchema,
    PluginCreateSchema,
    PluginDependencyCreateSchema,
    PluginDependencyOutSchema,
    PluginListSchema,
    PluginOutSchema,
    PluginReviewCreateSchema,
    PluginReviewOutSchema,
    PluginUpdateSchema,
    PluginVersionOutSchema,
    ServerPluginInstallSchema,
    ServerPluginOutSchema,
    ServerPluginUpdateSchema,
    UsageStatsSchema,
    WebhookCreateSchema,
    WebhookDeliveryOutSchema,
    WebhookOutSchema,
    WebhookTestSchema,
    WebhookUpdateSchema,
)
from apps.game_config.decorators import require_module_controller
from apps.pagination import paginate_qs

_BLOCKED_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata.google.internal"}


def _validate_webhook_url(url: str) -> None:
    """Validate that a webhook URL does not target private or internal networks (SSRF guard)."""
    parsed = urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        raise HttpError(400, "Invalid webhook URL")

    if hostname.lower() in _BLOCKED_HOSTNAMES:
        raise HttpError(400, "Webhook URL cannot target internal addresses")

    try:
        addr_info = socket.getaddrinfo(hostname, None)
        for _family, _type, _proto, _canonname, sockaddr in addr_info:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise HttpError(400, "Webhook URL cannot target private/internal networks")
    except socket.gaierror:
        raise HttpError(400, "Cannot resolve webhook URL hostname") from None


@api_controller("/developers", tags=["Developers"], permissions=[IsAuthenticated], auth=ActiveUserJWTAuth())
@require_module_controller("developers")
class DeveloperController:
    def _get_app(self, request, app_id: uuid.UUID) -> DeveloperApp:
        """Return the DeveloperApp owned by request.auth, or raise 404."""
        try:
            app = DeveloperApp.objects.get(id=app_id, is_active=True)
        except DeveloperApp.DoesNotExist:
            raise Http404 from None
        if app.owner_id != request.auth.id:
            raise Http404
        return app

    # -------------------------------------------------------------------------
    # Apps CRUD
    # -------------------------------------------------------------------------

    @route.post("/apps/", response=DeveloperAppCreatedSchema)
    def create_app(self, request, payload: DeveloperAppCreateSchema):
        """Create a new developer app. The client_secret is returned only once."""
        raw_secret, secret_hash = DeveloperApp.generate_secret()
        app = DeveloperApp.objects.create(
            name=payload.name,
            description=payload.description,
            client_secret_hash=secret_hash,
            owner=request.auth,
        )
        return DeveloperAppCreatedSchema(
            id=app.id,
            name=app.name,
            description=app.description,
            client_id=app.client_id,
            is_active=app.is_active,
            created_at=app.created_at,
            client_secret=raw_secret,
        )

    @route.get("/apps/", response=dict)
    def list_apps(self, request, limit: int = 50, offset: int = 0):
        """List all active developer apps owned by the authenticated user."""
        qs = (
            DeveloperApp.objects.filter(owner=request.auth, is_active=True)
            .exclude(client_id=DeveloperApp.CLI_CLIENT_ID)
            .order_by("-created_at")
        )
        return paginate_qs(qs, limit, offset, schema=DeveloperAppOutSchema)

    @route.get("/apps/{app_id}/", response=DeveloperAppOutSchema)
    def get_app(self, request, app_id: uuid.UUID):
        """Get details for a specific developer app."""
        return self._get_app(request, app_id)

    @route.patch("/apps/{app_id}/", response=DeveloperAppOutSchema)
    def update_app(self, request, app_id: uuid.UUID, payload: DeveloperAppUpdateSchema):
        """Update the name and/or description of a developer app."""
        app = self._get_app(request, app_id)
        update_fields = []
        if payload.name is not None:
            app.name = payload.name
            update_fields.append("name")
        if payload.description is not None:
            app.description = payload.description
            update_fields.append("description")
        if update_fields:
            app.save(update_fields=update_fields)
        return app

    @route.delete("/apps/{app_id}/")
    def delete_app(self, request, app_id: uuid.UUID):
        """Soft-delete a developer app by marking it inactive."""
        app = self._get_app(request, app_id)
        app.is_active = False
        app.save(update_fields=["is_active"])
        return {"ok": True}

    # -------------------------------------------------------------------------
    # API Keys CRUD
    # -------------------------------------------------------------------------

    @route.post("/apps/{app_id}/keys/", response=APIKeyCreatedSchema)
    def create_api_key(self, request, app_id: uuid.UUID, payload: APIKeyCreateSchema):
        """Create an API key for a developer app. The full key is returned only once."""
        app = self._get_app(request, app_id)

        invalid_scopes = [s for s in payload.scopes if s not in VALID_SCOPES]
        if invalid_scopes:
            raise HttpError(400, f"Invalid scopes: {', '.join(invalid_scopes)}")

        raw_key, prefix, key_hash = APIKey.generate_key()
        api_key = APIKey.objects.create(
            app=app,
            key_hash=key_hash,
            prefix=prefix,
            scopes=payload.scopes,
            rate_limit=payload.rate_limit,
        )
        return APIKeyCreatedSchema(
            id=api_key.id,
            prefix=api_key.prefix,
            scopes=api_key.scopes,
            rate_limit=api_key.rate_limit,
            is_active=api_key.is_active,
            last_used=api_key.last_used,
            created_at=api_key.created_at,
            key=raw_key,
        )

    @route.get("/apps/{app_id}/keys/", response=dict)
    def list_api_keys(self, request, app_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List all API keys for a developer app."""
        app = self._get_app(request, app_id)
        return paginate_qs(app.api_keys.order_by("-created_at"), limit, offset, schema=APIKeyOutSchema)

    @route.delete("/apps/{app_id}/keys/{key_id}/")
    def deactivate_api_key(self, request, app_id: uuid.UUID, key_id: uuid.UUID):
        """Deactivate an API key."""
        app = self._get_app(request, app_id)
        try:
            api_key = app.api_keys.get(id=key_id)
        except APIKey.DoesNotExist:
            raise HttpError(404, "Not found") from None
        api_key.is_active = False
        api_key.save(update_fields=["is_active"])
        return {"ok": True}

    # -------------------------------------------------------------------------
    # Webhooks CRUD
    # -------------------------------------------------------------------------

    @route.post("/apps/{app_id}/webhooks/", response=WebhookOutSchema)
    def create_webhook(self, request, app_id: uuid.UUID, payload: WebhookCreateSchema):
        """Create a webhook for a developer app."""
        app = self._get_app(request, app_id)

        invalid_events = [e for e in payload.events if e not in VALID_EVENTS]
        if invalid_events:
            raise HttpError(400, f"Invalid events: {', '.join(invalid_events)}")

        _validate_webhook_url(payload.url)

        webhook = Webhook.objects.create(
            app=app,
            url=payload.url,
            events=payload.events,
        )
        return webhook

    @route.get("/apps/{app_id}/webhooks/", response=dict)
    def list_webhooks(self, request, app_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List all webhooks for a developer app."""
        app = self._get_app(request, app_id)
        return paginate_qs(app.webhooks.order_by("-created_at"), limit, offset, schema=WebhookOutSchema)

    @route.patch("/apps/{app_id}/webhooks/{webhook_id}/", response=WebhookOutSchema)
    def update_webhook(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID, payload: WebhookUpdateSchema):
        """Update a webhook's url, events, or active status."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, "Not found") from None

        if payload.events is not None:
            invalid_events = [e for e in payload.events if e not in VALID_EVENTS]
            if invalid_events:
                return self.create_response(
                    {"detail": f"Invalid events: {', '.join(invalid_events)}"},
                    status_code=400,
                )

        update_fields = []
        if payload.url is not None:
            _validate_webhook_url(payload.url)
            webhook.url = payload.url
            update_fields.append("url")
        if payload.events is not None:
            webhook.events = payload.events
            update_fields.append("events")
        if payload.is_active is not None:
            webhook.is_active = payload.is_active
            update_fields.append("is_active")
        if update_fields:
            webhook.save(update_fields=update_fields)
        return webhook

    @route.delete("/apps/{app_id}/webhooks/{webhook_id}/")
    def deactivate_webhook(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID):
        """Deactivate a webhook."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, "Not found") from None
        webhook.is_active = False
        webhook.save(update_fields=["is_active"])
        return {"ok": True}

    @route.post("/apps/{app_id}/webhooks/{webhook_id}/test/", response=WebhookTestSchema)
    def test_webhook(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID):
        """Send a test ping to a webhook via the deliver_webhook Celery task."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, "Not found") from None

        try:
            from apps.developers.tasks import deliver_webhook

            deliver_webhook.delay(
                webhook_id=str(webhook.id),
                event="webhook.test",
                payload={"test": True},
            )
            return WebhookTestSchema(
                success=True,
                status_code=None,
                message="Test ping queued successfully.",
            )
        except Exception as exc:
            return WebhookTestSchema(
                success=False,
                status_code=None,
                message=f"Failed to queue test delivery: {exc}",
            )

    @route.get("/apps/{app_id}/webhooks/{webhook_id}/deliveries/", response=dict)
    def list_webhook_deliveries(
        self, request, app_id: uuid.UUID, webhook_id: uuid.UUID, limit: int = 50, offset: int = 0
    ):
        """List deliveries for a webhook."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, "Not found") from None
        return paginate_qs(webhook.deliveries.order_by("-created_at"), limit, offset, schema=WebhookDeliveryOutSchema)

    # -------------------------------------------------------------------------
    # Usage stats
    # -------------------------------------------------------------------------

    @route.get("/apps/{app_id}/usage/", response=UsageStatsSchema)
    def get_usage(self, request, app_id: uuid.UUID):
        """Return aggregated usage statistics for a developer app."""
        app = self._get_app(request, app_id)

        active_keys = app.api_keys.filter(is_active=True).count()
        total_webhooks = app.webhooks.count()
        active_webhooks = app.webhooks.filter(is_active=True).count()
        total_deliveries = WebhookDelivery.objects.filter(webhook__app=app).count()
        successful_deliveries = WebhookDelivery.objects.filter(webhook__app=app, success=True).count()
        failed_deliveries = WebhookDelivery.objects.filter(webhook__app=app, success=False).count()

        # Sum up 24-hour API usage counters for all active keys in this app
        total_api_calls = 0
        for key in app.api_keys.filter(is_active=True):
            usage_key = f"api_usage:{app.id}:{key.id}"
            total_api_calls += cache.get(usage_key, 0)

        return UsageStatsSchema(
            app_id=app.id,
            total_api_calls=total_api_calls,
            active_keys=active_keys,
            total_webhooks=total_webhooks,
            active_webhooks=active_webhooks,
            total_deliveries=total_deliveries,
            successful_deliveries=successful_deliveries,
            failed_deliveries=failed_deliveries,
        )

    # -------------------------------------------------------------------------
    # Community Servers CRUD
    # -------------------------------------------------------------------------

    @route.post("/apps/{app_id}/servers/", response=CommunityServerOutSchema)
    def register_server(self, request, app_id: uuid.UUID, payload: CommunityServerCreateSchema):
        """Register a community server for a developer app."""
        app = self._get_app(request, app_id)
        password_hash = ""
        if payload.password:
            password_hash = hashlib.sha256(payload.password.encode()).hexdigest()
        server = CommunityServer.objects.create(
            app=app,
            name=payload.name,
            description=payload.description,
            region=payload.region,
            max_players=payload.max_players,
            is_public=payload.is_public,
            custom_config=payload.custom_config,
            max_concurrent_matches=payload.max_concurrent_matches,
            motd=payload.motd,
            tags=payload.tags,
            auto_start_match=payload.auto_start_match,
            min_players_to_start=payload.min_players_to_start,
            match_start_countdown_seconds=payload.match_start_countdown_seconds,
            allow_spectators=payload.allow_spectators,
            max_spectators=payload.max_spectators,
            allow_custom_game_modes=payload.allow_custom_game_modes,
            password_hash=password_hash,
        )
        return CommunityServerOutSchema.from_orm(server)

    @route.get("/apps/{app_id}/servers/", response=dict)
    def list_servers(self, request, app_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List all community servers for a developer app."""
        app = self._get_app(request, app_id)
        qs = app.servers.order_by("-created_at")
        return paginate_qs(qs, limit, offset, schema=CommunityServerOutSchema)

    @route.patch("/apps/{app_id}/servers/{server_id}/", response=CommunityServerOutSchema)
    def update_server(self, request, app_id: uuid.UUID, server_id: uuid.UUID, payload: CommunityServerUpdateSchema):
        """Update a community server's configuration."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Not found") from None

        simple_fields = [
            "name",
            "description",
            "max_players",
            "is_public",
            "custom_config",
            "max_concurrent_matches",
            "motd",
            "tags",
            "auto_start_match",
            "min_players_to_start",
            "match_start_countdown_seconds",
            "allow_spectators",
            "max_spectators",
            "allow_custom_game_modes",
        ]
        update_fields = []
        for field in simple_fields:
            val = getattr(payload, field, None)
            if val is not None:
                setattr(server, field, val)
                update_fields.append(field)
        if payload.password is not None:
            server.password_hash = hashlib.sha256(payload.password.encode()).hexdigest() if payload.password else ""
            update_fields.append("password_hash")
        if update_fields:
            update_fields.append("updated_at")
            server.save(update_fields=update_fields)
        return CommunityServerOutSchema.from_orm(server)

    @route.delete("/apps/{app_id}/servers/{server_id}/")
    def deregister_server(self, request, app_id: uuid.UUID, server_id: uuid.UUID):
        """Deregister (delete) a community server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Not found") from None
        server.delete()
        return {"ok": True}

    # -------------------------------------------------------------------------
    # Plugins CRUD
    # -------------------------------------------------------------------------

    @route.post("/apps/{app_id}/plugins/", response=PluginOutSchema)
    def create_plugin(self, request, app_id: uuid.UUID, payload: PluginCreateSchema):
        """Create a new plugin for a developer app."""
        app = self._get_app(request, app_id)
        plugin = Plugin.objects.create(
            app=app,
            name=payload.name,
            slug=payload.slug,
            description=payload.description,
            version="0.1.0",
            hooks=payload.hooks,
        )
        return PluginOutSchema.from_orm(plugin)

    @route.get("/apps/{app_id}/plugins/", response=dict)
    def list_plugins(self, request, app_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List all plugins for a developer app."""
        app = self._get_app(request, app_id)
        qs = app.plugins.order_by("-created_at")
        return paginate_qs(qs, limit, offset, schema=PluginOutSchema)

    # -------------------------------------------------------------------------
    # Meta listings
    # -------------------------------------------------------------------------

    @route.get("/scopes/", response=AvailableScopesSchema)
    def list_scopes(self, request):
        """Return all valid API key scopes."""
        return AvailableScopesSchema(scopes=VALID_SCOPES)

    @route.get("/events/", response=AvailableEventsSchema)
    def list_events(self, request):
        """Return all valid webhook event types."""
        return AvailableEventsSchema(events=VALID_EVENTS)

    @route.get("/hooks/", response=AvailableHooksSchema)
    def list_hooks(self, request):
        """Return all valid plugin hooks."""
        return AvailableHooksSchema(hooks=VALID_HOOKS)

    # -------------------------------------------------------------------------
    # Server → Plugin Management (install/uninstall/configure)
    # -------------------------------------------------------------------------

    @route.post("/apps/{app_id}/servers/{server_id}/plugins/", response=ServerPluginOutSchema)
    def install_plugin(self, request, app_id: uuid.UUID, server_id: uuid.UUID, payload: ServerPluginInstallSchema):
        """Install a plugin on a community server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None

        try:
            plugin = Plugin.objects.get(slug=payload.plugin_slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, f"Plugin '{payload.plugin_slug}' not found") from None

        if ServerPlugin.objects.filter(server=server, plugin=plugin).exists():
            raise HttpError(409, f"Plugin '{payload.plugin_slug}' is already installed")

        plugin_version = None
        if payload.version:
            plugin_version = PluginVersion.objects.filter(
                plugin=plugin, version=payload.version, is_yanked=False
            ).first()
            if not plugin_version:
                raise HttpError(404, f"Version '{payload.version}' not found")

        sp = ServerPlugin.objects.create(
            server=server,
            plugin=plugin,
            plugin_version=plugin_version,
            config=payload.config,
            priority=payload.priority,
        )
        Plugin.objects.filter(pk=plugin.pk).update(install_count=db_models.F("install_count") + 1)
        return ServerPluginOutSchema.from_orm(sp)

    @route.get("/apps/{app_id}/servers/{server_id}/plugins/", response=dict)
    def list_server_plugins(self, request, app_id: uuid.UUID, server_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List plugins installed on a server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None
        qs = server.installed_plugins.select_related("plugin", "plugin_version").order_by("priority")
        return paginate_qs(qs, limit, offset, schema=ServerPluginOutSchema)

    @route.patch("/apps/{app_id}/servers/{server_id}/plugins/{plugin_slug}/", response=ServerPluginOutSchema)
    def update_server_plugin(
        self, request, app_id: uuid.UUID, server_id: uuid.UUID, plugin_slug: str, payload: ServerPluginUpdateSchema
    ):
        """Update plugin configuration on a server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None

        try:
            sp = server.installed_plugins.select_related("plugin", "plugin_version").get(plugin__slug=plugin_slug)
        except ServerPlugin.DoesNotExist:
            raise HttpError(404, f"Plugin '{plugin_slug}' not installed") from None

        update_fields = []
        if payload.config is not None:
            sp.config = payload.config
            update_fields.append("config")
        if payload.is_enabled is not None:
            sp.is_enabled = payload.is_enabled
            update_fields.append("is_enabled")
        if payload.priority is not None:
            sp.priority = payload.priority
            update_fields.append("priority")
        if update_fields:
            update_fields.append("updated_at")
            sp.save(update_fields=update_fields)
        return ServerPluginOutSchema.from_orm(sp)

    @route.delete("/apps/{app_id}/servers/{server_id}/plugins/{plugin_slug}/")
    def uninstall_plugin(self, request, app_id: uuid.UUID, server_id: uuid.UUID, plugin_slug: str):
        """Uninstall a plugin from a server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None

        try:
            sp = server.installed_plugins.get(plugin__slug=plugin_slug)
        except ServerPlugin.DoesNotExist:
            raise HttpError(404, f"Plugin '{plugin_slug}' not installed") from None

        sp.delete()
        return {"ok": True}

    # -------------------------------------------------------------------------
    # Server → Custom Game Modes
    # -------------------------------------------------------------------------

    @route.post("/apps/{app_id}/servers/{server_id}/game-modes/", response=CustomGameModeOutSchema)
    def create_custom_game_mode(
        self, request, app_id: uuid.UUID, server_id: uuid.UUID, payload: CustomGameModeCreateSchema
    ):
        """Create a custom game mode for a community server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None

        if not server.allow_custom_game_modes:
            raise HttpError(403, "Custom game modes are not enabled on this server")

        base_mode = None
        if payload.base_game_mode_slug:
            from apps.game_config.models import GameMode

            base_mode = GameMode.objects.filter(slug=payload.base_game_mode_slug, is_active=True).first()
            if not base_mode:
                raise HttpError(404, f"Base game mode '{payload.base_game_mode_slug}' not found")

        gm = CustomGameMode.objects.create(
            server=server,
            creator=request.auth,
            name=payload.name,
            slug=payload.slug,
            description=payload.description,
            icon=payload.icon,
            base_game_mode=base_mode,
            config_overrides=payload.config_overrides,
            is_public=payload.is_public,
        )
        return CustomGameModeOutSchema.from_orm(gm)

    @route.get("/apps/{app_id}/servers/{server_id}/game-modes/", response=dict)
    def list_custom_game_modes(
        self, request, app_id: uuid.UUID, server_id: uuid.UUID, limit: int = 50, offset: int = 0
    ):
        """List custom game modes for a server."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None
        qs = server.custom_game_modes.filter(is_active=True)
        return paginate_qs(qs, limit, offset, schema=CustomGameModeOutSchema)

    @route.patch("/apps/{app_id}/servers/{server_id}/game-modes/{mode_slug}/", response=CustomGameModeOutSchema)
    def update_custom_game_mode(
        self,
        request,
        app_id: uuid.UUID,
        server_id: uuid.UUID,
        mode_slug: str,
        payload: CustomGameModeUpdateSchema,
    ):
        """Update a custom game mode."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None

        try:
            gm = server.custom_game_modes.get(slug=mode_slug)
        except CustomGameMode.DoesNotExist:
            raise HttpError(404, "Game mode not found") from None

        update_fields = []
        for field in ["name", "description", "icon", "config_overrides", "is_public", "is_active"]:
            val = getattr(payload, field, None)
            if val is not None:
                setattr(gm, field, val)
                update_fields.append(field)
        if update_fields:
            update_fields.append("updated_at")
            gm.save(update_fields=update_fields)
        return CustomGameModeOutSchema.from_orm(gm)

    @route.delete("/apps/{app_id}/servers/{server_id}/game-modes/{mode_slug}/")
    def delete_custom_game_mode(self, request, app_id: uuid.UUID, server_id: uuid.UUID, mode_slug: str):
        """Delete a custom game mode."""
        app = self._get_app(request, app_id)
        try:
            server = app.servers.get(id=server_id)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Server not found") from None

        try:
            gm = server.custom_game_modes.get(slug=mode_slug)
        except CustomGameMode.DoesNotExist:
            raise HttpError(404, "Game mode not found") from None

        gm.delete()
        return {"ok": True}

    # -------------------------------------------------------------------------
    # Plugin Update / Version / Dependency management (developer)
    # -------------------------------------------------------------------------

    @route.patch("/apps/{app_id}/plugins/{slug}/", response=PluginOutSchema)
    def update_plugin(self, request, app_id: uuid.UUID, slug: str, payload: PluginUpdateSchema):
        """Update a plugin's metadata."""
        app = self._get_app(request, app_id)
        try:
            plugin = app.plugins.get(slug=slug)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Plugin not found") from None

        update_fields = []
        for field in [
            "description",
            "long_description",
            "hooks",
            "category",
            "tags",
            "homepage_url",
            "source_url",
            "license",
            "config_schema",
            "default_config",
            "min_engine_version",
            "required_permissions",
            "is_deprecated",
            "deprecation_message",
        ]:
            val = getattr(payload, field, None)
            if val is not None:
                setattr(plugin, field, val)
                update_fields.append(field)
        if update_fields:
            update_fields.append("updated_at")
            plugin.save(update_fields=update_fields)
        return PluginOutSchema.from_orm(plugin)

    @route.post("/apps/{app_id}/plugins/{slug}/dependencies/", response=PluginDependencyOutSchema)
    def add_plugin_dependency(self, request, app_id: uuid.UUID, slug: str, payload: PluginDependencyCreateSchema):
        """Add a dependency to a plugin."""
        app = self._get_app(request, app_id)
        try:
            plugin = app.plugins.get(slug=slug)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Plugin not found") from None

        try:
            depends_on = Plugin.objects.get(slug=payload.depends_on_slug)
        except Plugin.DoesNotExist:
            raise HttpError(404, f"Dependency plugin '{payload.depends_on_slug}' not found") from None

        if plugin.pk == depends_on.pk:
            raise HttpError(400, "A plugin cannot depend on itself")

        dep, created = PluginDependency.objects.get_or_create(
            plugin=plugin,
            depends_on=depends_on,
            defaults={
                "version_constraint": payload.version_constraint,
                "is_optional": payload.is_optional,
            },
        )
        if not created:
            raise HttpError(409, "Dependency already exists")

        return PluginDependencyOutSchema.from_orm(dep)

    @route.get("/apps/{app_id}/plugins/{slug}/dependencies/", response=list[PluginDependencyOutSchema])
    def list_plugin_dependencies(self, request, app_id: uuid.UUID, slug: str):
        """List dependencies for a plugin."""
        app = self._get_app(request, app_id)
        try:
            plugin = app.plugins.get(slug=slug)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Plugin not found") from None
        return [PluginDependencyOutSchema.from_orm(d) for d in plugin.dependencies.select_related("depends_on")]

    @route.delete("/apps/{app_id}/plugins/{slug}/dependencies/{dep_slug}/")
    def remove_plugin_dependency(self, request, app_id: uuid.UUID, slug: str, dep_slug: str):
        """Remove a dependency from a plugin."""
        app = self._get_app(request, app_id)
        try:
            plugin = app.plugins.get(slug=slug)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Plugin not found") from None

        deleted, _ = PluginDependency.objects.filter(plugin=plugin, depends_on__slug=dep_slug).delete()
        if not deleted:
            raise HttpError(404, "Dependency not found")
        return {"ok": True}


# =========================================================================
# Public Plugin Marketplace Controller
# =========================================================================


@api_controller("/plugins", tags=["Plugin Marketplace"], auth=None)
@require_module_controller("developers")
class PluginController:
    @route.get("/", response=dict)
    def list_published_plugins(
        self,
        request,
        limit: int = 50,
        offset: int = 0,
        category: str | None = None,
        tag: str | None = None,
        search: str | None = None,
        sort: str = "popular",
        featured: bool | None = None,
    ):
        """List all published and approved plugins with filtering and sorting."""
        qs = Plugin.objects.filter(is_published=True, is_approved=True, is_deprecated=False).select_related("app")

        if category:
            qs = qs.filter(category=category)
        if tag:
            qs = qs.filter(tags__contains=[tag])
        if search:
            qs = qs.filter(
                db_models.Q(name__icontains=search)
                | db_models.Q(description__icontains=search)
                | db_models.Q(slug__icontains=search)
            )
        if featured is not None:
            qs = qs.filter(is_featured=featured)

        if sort == "newest":
            qs = qs.order_by("-created_at")
        elif sort == "rating":
            qs = qs.order_by("-rating_sum")
        elif sort == "downloads":
            qs = qs.order_by("-download_count")
        else:  # "popular" — combined score
            qs = qs.order_by("-install_count", "-rating_sum")

        return paginate_qs(qs, limit, offset, schema=PluginListSchema)

    @route.get("/categories/", response=list[dict])
    def list_categories(self, request):
        """Return all plugin categories with counts."""
        qs = Plugin.objects.filter(is_published=True, is_approved=True, is_deprecated=False)
        result = []
        for value, label in PLUGIN_CATEGORIES:
            count = qs.filter(category=value).count()
            result.append({"value": value, "label": label, "count": count})
        return result

    @route.get("/featured/", response=dict)
    def list_featured_plugins(self, request, limit: int = 10, offset: int = 0):
        """List featured plugins for the marketplace homepage."""
        qs = (
            Plugin.objects.filter(is_published=True, is_approved=True, is_featured=True, is_deprecated=False)
            .select_related("app")
            .order_by("-install_count")
        )
        return paginate_qs(qs, limit, offset, schema=PluginListSchema)

    @route.get("/{slug}/", response=PluginOutSchema)
    def get_plugin(self, request, slug: str):
        """Get details for a specific published plugin."""
        try:
            plugin = Plugin.objects.select_related("app").get(slug=slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Not found") from None
        return PluginOutSchema.from_orm(plugin)

    @route.get("/{slug}/versions/", response=dict)
    def list_plugin_versions(self, request, slug: str, limit: int = 50, offset: int = 0):
        """List all versions for a published plugin."""
        try:
            plugin = Plugin.objects.get(slug=slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Not found") from None
        qs = plugin.versions.filter(is_yanked=False)
        return paginate_qs(qs, limit, offset, schema=PluginVersionOutSchema)

    @route.get("/{slug}/dependencies/", response=list[PluginDependencyOutSchema])
    def get_plugin_dependencies(self, request, slug: str):
        """Get dependencies for a published plugin."""
        try:
            plugin = Plugin.objects.get(slug=slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Not found") from None
        return [PluginDependencyOutSchema.from_orm(d) for d in plugin.dependencies.select_related("depends_on")]

    @route.get("/{slug}/reviews/", response=dict)
    def list_plugin_reviews(self, request, slug: str, limit: int = 50, offset: int = 0):
        """List reviews for a published plugin."""
        try:
            plugin = Plugin.objects.get(slug=slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Not found") from None
        qs = plugin.reviews.select_related("user").order_by("-created_at")
        return paginate_qs(qs, limit, offset, schema=PluginReviewOutSchema)


@api_controller("/plugins", tags=["Plugin Reviews"], permissions=[IsAuthenticated], auth=ActiveUserJWTAuth())
@require_module_controller("developers")
class PluginReviewController:
    @route.post("/{slug}/reviews/", response=PluginReviewOutSchema)
    def create_review(self, request, slug: str, payload: PluginReviewCreateSchema):
        """Submit a review for a plugin."""
        try:
            plugin = Plugin.objects.get(slug=slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Not found") from None

        if payload.rating < 1 or payload.rating > 5:
            raise HttpError(400, "Rating must be between 1 and 5")

        if PluginReview.objects.filter(plugin=plugin, user=request.auth).exists():
            raise HttpError(409, "You have already reviewed this plugin")

        review = PluginReview.objects.create(
            plugin=plugin,
            user=request.auth,
            rating=payload.rating,
            title=payload.title,
            body=payload.body,
        )
        return PluginReviewOutSchema.from_orm(review)


# =========================================================================
# Public Community Server Controller
# =========================================================================


@api_controller("/servers", tags=["Community Servers"], auth=None)
@require_module_controller("developers")
class CommunityServerController:
    @route.get("/", response=dict)
    def list_public_servers(
        self,
        request,
        limit: int = 50,
        offset: int = 0,
        region: str | None = None,
        tag: str | None = None,
        search: str | None = None,
        has_slots: bool | None = None,
        sort: str = "players",
    ):
        """List all public online community servers with filtering."""
        qs = CommunityServer.objects.filter(is_public=True, status="online").select_related("app")
        if region:
            qs = qs.filter(region=region)
        if tag:
            qs = qs.filter(tags__contains=[tag])
        if search:
            qs = qs.filter(db_models.Q(name__icontains=search) | db_models.Q(description__icontains=search))
        if has_slots:
            qs = qs.filter(current_player_count__lt=db_models.F("max_players"))

        if sort == "newest":
            qs = qs.order_by("-created_at")
        elif sort == "name":
            qs = qs.order_by("name")
        else:  # "players"
            qs = qs.order_by("-current_player_count")

        return paginate_qs(qs, limit, offset, schema=CommunityServerListSchema)

    @route.get("/{server_id}/", response=CommunityServerOutSchema)
    def get_server(self, request, server_id: uuid.UUID):
        """Get details for a specific public community server."""
        try:
            server = CommunityServer.objects.get(id=server_id, is_public=True)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Not found") from None
        return CommunityServerOutSchema.from_orm(server)

    @route.get("/{server_id}/plugins/", response=dict)
    def list_server_plugins(self, request, server_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List plugins installed on a public server."""
        try:
            server = CommunityServer.objects.get(id=server_id, is_public=True)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Not found") from None
        qs = server.installed_plugins.filter(is_enabled=True).select_related("plugin", "plugin_version")
        return paginate_qs(qs, limit, offset, schema=ServerPluginOutSchema)

    @route.get("/{server_id}/game-modes/", response=dict)
    def list_server_game_modes(self, request, server_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List custom game modes on a public server."""
        try:
            server = CommunityServer.objects.get(id=server_id, is_public=True)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Not found") from None
        qs = server.custom_game_modes.filter(is_active=True, is_public=True)
        return paginate_qs(qs, limit, offset, schema=CustomGameModeOutSchema)
