import ipaddress
import socket
import uuid
from urllib.parse import urlparse

from django.core.cache import cache
from django.http import Http404
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.developers.models import (
    VALID_EVENTS,
    VALID_SCOPES,
    APIKey,
    CommunityServer,
    DeveloperApp,
    Plugin,
    Webhook,
    WebhookDelivery,
)
from apps.developers.schemas import (
    APIKeyCreatedSchema,
    APIKeyCreateSchema,
    APIKeyOutSchema,
    AvailableEventsSchema,
    AvailableScopesSchema,
    CommunityServerCreateSchema,
    CommunityServerListSchema,
    CommunityServerOutSchema,
    CommunityServerUpdateSchema,
    DeveloperAppCreatedSchema,
    DeveloperAppCreateSchema,
    DeveloperAppOutSchema,
    DeveloperAppUpdateSchema,
    PluginCreateSchema,
    PluginListSchema,
    PluginOutSchema,
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
        qs = DeveloperApp.objects.filter(owner=request.auth, is_active=True).order_by("-created_at")
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
        server = CommunityServer.objects.create(
            app=app,
            name=payload.name,
            description=payload.description,
            region=payload.region,
            max_players=payload.max_players,
            is_public=payload.is_public,
            custom_config=payload.custom_config,
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

        update_fields = []
        if payload.name is not None:
            server.name = payload.name
            update_fields.append("name")
        if payload.description is not None:
            server.description = payload.description
            update_fields.append("description")
        if payload.max_players is not None:
            server.max_players = payload.max_players
            update_fields.append("max_players")
        if payload.is_public is not None:
            server.is_public = payload.is_public
            update_fields.append("is_public")
        if payload.custom_config is not None:
            server.custom_config = payload.custom_config
            update_fields.append("custom_config")
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


@api_controller("/plugins", tags=["Plugins"], auth=None)
@require_module_controller("developers")
class PluginController:
    @route.get("/", response=dict)
    def list_published_plugins(self, request, limit: int = 50, offset: int = 0):
        """List all published and approved plugins."""
        qs = Plugin.objects.filter(is_published=True, is_approved=True).select_related("app")
        return paginate_qs(qs, limit, offset, schema=PluginListSchema)

    @route.get("/{slug}/", response=PluginOutSchema)
    def get_plugin(self, request, slug: str):
        """Get details for a specific published plugin."""
        try:
            plugin = Plugin.objects.get(slug=slug, is_published=True, is_approved=True)
        except Plugin.DoesNotExist:
            raise HttpError(404, "Not found") from None
        return PluginOutSchema.from_orm(plugin)


@api_controller("/servers", tags=["Community Servers"], auth=None)
@require_module_controller("developers")
class CommunityServerController:
    @route.get("/", response=dict)
    def list_public_servers(self, request, limit: int = 50, offset: int = 0, region: str | None = None):
        """List all public online community servers."""
        qs = CommunityServer.objects.filter(is_public=True, status="online").select_related("app")
        if region:
            qs = qs.filter(region=region)
        return paginate_qs(qs, limit, offset, schema=CommunityServerListSchema)

    @route.get("/{server_id}/", response=CommunityServerOutSchema)
    def get_server(self, request, server_id: uuid.UUID):
        """Get details for a specific public community server."""
        try:
            server = CommunityServer.objects.get(id=server_id, is_public=True)
        except CommunityServer.DoesNotExist:
            raise HttpError(404, "Not found") from None
        return CommunityServerOutSchema.from_orm(server)
