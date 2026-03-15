import uuid
from typing import List

from django.core.cache import cache
from django.http import Http404
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from apps.accounts.auth import ActiveUserJWTAuth
from apps.pagination import paginate_qs

from apps.developers.models import (
    VALID_EVENTS,
    VALID_SCOPES,
    APIKey,
    DeveloperApp,
    Webhook,
    WebhookDelivery,
)
from apps.developers.schemas import (
    APIKeyCreatedSchema,
    APIKeyOutSchema,
    APIKeyCreateSchema,
    AvailableEventsSchema,
    AvailableScopesSchema,
    DeveloperAppCreatedSchema,
    DeveloperAppCreateSchema,
    DeveloperAppOutSchema,
    DeveloperAppUpdateSchema,
    UsageStatsSchema,
    WebhookCreateSchema,
    WebhookDeliveryOutSchema,
    WebhookOutSchema,
    WebhookTestSchema,
    WebhookUpdateSchema,
)


@api_controller('/developers', tags=['Developers'], permissions=[IsAuthenticated], auth=ActiveUserJWTAuth())
class DeveloperController:

    def _get_app(self, request, app_id: uuid.UUID) -> DeveloperApp:
        """Return the DeveloperApp owned by request.auth, or raise 404."""
        try:
            app = DeveloperApp.objects.get(id=app_id, is_active=True)
        except DeveloperApp.DoesNotExist:
            raise Http404
        if app.owner_id != request.auth.id:
            raise Http404
        return app

    # -------------------------------------------------------------------------
    # Apps CRUD
    # -------------------------------------------------------------------------

    @route.post('/apps/', response=DeveloperAppCreatedSchema)
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

    @route.get('/apps/', response=dict)
    def list_apps(self, request, limit: int = 50, offset: int = 0):
        """List all active developer apps owned by the authenticated user."""
        qs = DeveloperApp.objects.filter(owner=request.auth, is_active=True).order_by('-created_at')
        return paginate_qs(qs, limit, offset, schema=DeveloperAppOutSchema)

    @route.get('/apps/{app_id}/', response=DeveloperAppOutSchema)
    def get_app(self, request, app_id: uuid.UUID):
        """Get details for a specific developer app."""
        return self._get_app(request, app_id)

    @route.patch('/apps/{app_id}/', response=DeveloperAppOutSchema)
    def update_app(self, request, app_id: uuid.UUID, payload: DeveloperAppUpdateSchema):
        """Update the name and/or description of a developer app."""
        app = self._get_app(request, app_id)
        update_fields = []
        if payload.name is not None:
            app.name = payload.name
            update_fields.append('name')
        if payload.description is not None:
            app.description = payload.description
            update_fields.append('description')
        if update_fields:
            app.save(update_fields=update_fields)
        return app

    @route.delete('/apps/{app_id}/')
    def delete_app(self, request, app_id: uuid.UUID):
        """Soft-delete a developer app by marking it inactive."""
        app = self._get_app(request, app_id)
        app.is_active = False
        app.save(update_fields=['is_active'])
        return {'ok': True}

    # -------------------------------------------------------------------------
    # API Keys CRUD
    # -------------------------------------------------------------------------

    @route.post('/apps/{app_id}/keys/', response=APIKeyCreatedSchema)
    def create_api_key(self, request, app_id: uuid.UUID, payload: APIKeyCreateSchema):
        """Create an API key for a developer app. The full key is returned only once."""
        app = self._get_app(request, app_id)

        invalid_scopes = [s for s in payload.scopes if s not in VALID_SCOPES]
        if invalid_scopes:
            raise HttpError(400, f'Invalid scopes: {", ".join(invalid_scopes)}')

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

    @route.get('/apps/{app_id}/keys/', response=dict)
    def list_api_keys(self, request, app_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List all API keys for a developer app."""
        app = self._get_app(request, app_id)
        return paginate_qs(app.api_keys.order_by('-created_at'), limit, offset, schema=APIKeyOutSchema)

    @route.delete('/apps/{app_id}/keys/{key_id}/')
    def deactivate_api_key(self, request, app_id: uuid.UUID, key_id: uuid.UUID):
        """Deactivate an API key."""
        app = self._get_app(request, app_id)
        try:
            api_key = app.api_keys.get(id=key_id)
        except APIKey.DoesNotExist:
            raise HttpError(404, 'Not found')
        api_key.is_active = False
        api_key.save(update_fields=['is_active'])
        return {'ok': True}

    # -------------------------------------------------------------------------
    # Webhooks CRUD
    # -------------------------------------------------------------------------

    @route.post('/apps/{app_id}/webhooks/', response=WebhookOutSchema)
    def create_webhook(self, request, app_id: uuid.UUID, payload: WebhookCreateSchema):
        """Create a webhook for a developer app."""
        app = self._get_app(request, app_id)

        invalid_events = [e for e in payload.events if e not in VALID_EVENTS]
        if invalid_events:
            raise HttpError(400, f'Invalid events: {", ".join(invalid_events)}')

        webhook = Webhook.objects.create(
            app=app,
            url=payload.url,
            events=payload.events,
        )
        return webhook

    @route.get('/apps/{app_id}/webhooks/', response=dict)
    def list_webhooks(self, request, app_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List all webhooks for a developer app."""
        app = self._get_app(request, app_id)
        return paginate_qs(app.webhooks.order_by('-created_at'), limit, offset, schema=WebhookOutSchema)

    @route.patch('/apps/{app_id}/webhooks/{webhook_id}/', response=WebhookOutSchema)
    def update_webhook(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID, payload: WebhookUpdateSchema):
        """Update a webhook's url, events, or active status."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, 'Not found')

        if payload.events is not None:
            invalid_events = [e for e in payload.events if e not in VALID_EVENTS]
            if invalid_events:
                return self.create_response(
                    {'detail': f'Invalid events: {", ".join(invalid_events)}'},
                    status_code=400,
                )

        update_fields = []
        if payload.url is not None:
            webhook.url = payload.url
            update_fields.append('url')
        if payload.events is not None:
            webhook.events = payload.events
            update_fields.append('events')
        if payload.is_active is not None:
            webhook.is_active = payload.is_active
            update_fields.append('is_active')
        if update_fields:
            webhook.save(update_fields=update_fields)
        return webhook

    @route.delete('/apps/{app_id}/webhooks/{webhook_id}/')
    def deactivate_webhook(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID):
        """Deactivate a webhook."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, 'Not found')
        webhook.is_active = False
        webhook.save(update_fields=['is_active'])
        return {'ok': True}

    @route.post('/apps/{app_id}/webhooks/{webhook_id}/test/', response=WebhookTestSchema)
    def test_webhook(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID):
        """Send a test ping to a webhook via the deliver_webhook Celery task."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, 'Not found')

        try:
            from apps.developers.tasks import deliver_webhook
            deliver_webhook.delay(
                webhook_id=str(webhook.id),
                event='webhook.test',
                payload={'test': True},
            )
            return WebhookTestSchema(
                success=True,
                status_code=None,
                message='Test ping queued successfully.',
            )
        except Exception as exc:
            return WebhookTestSchema(
                success=False,
                status_code=None,
                message=f'Failed to queue test delivery: {exc}',
            )

    @route.get('/apps/{app_id}/webhooks/{webhook_id}/deliveries/', response=dict)
    def list_webhook_deliveries(self, request, app_id: uuid.UUID, webhook_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """List deliveries for a webhook."""
        app = self._get_app(request, app_id)
        try:
            webhook = app.webhooks.get(id=webhook_id)
        except Webhook.DoesNotExist:
            raise HttpError(404, 'Not found')
        return paginate_qs(webhook.deliveries.order_by('-created_at'), limit, offset, schema=WebhookDeliveryOutSchema)

    # -------------------------------------------------------------------------
    # Usage stats
    # -------------------------------------------------------------------------

    @route.get('/apps/{app_id}/usage/', response=UsageStatsSchema)
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
    # Meta listings
    # -------------------------------------------------------------------------

    @route.get('/scopes/', response=AvailableScopesSchema)
    def list_scopes(self, request):
        """Return all valid API key scopes."""
        return AvailableScopesSchema(scopes=VALID_SCOPES)

    @route.get('/events/', response=AvailableEventsSchema)
    def list_events(self, request):
        """Return all valid webhook event types."""
        return AvailableEventsSchema(events=VALID_EVENTS)
