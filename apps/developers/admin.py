from django.contrib import admin

from apps.developers.models import (
    APIKey,
    DeveloperApp,
    OAuthAccessToken,
    OAuthAuthorizationCode,
    Webhook,
    WebhookDelivery,
)


class WebhookDeliveryInline(admin.TabularInline):
    model = WebhookDelivery
    extra = 0
    max_num = 20
    readonly_fields = (
        'id',
        'event',
        'payload',
        'response_status',
        'response_body',
        'success',
        'created_at',
    )


@admin.register(DeveloperApp)
class DeveloperAppAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'client_id', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'owner__username')
    readonly_fields = ('id', 'client_id', 'client_secret_hash', 'created_at')


@admin.register(APIKey)
class APIKeyAdmin(admin.ModelAdmin):
    list_display = ('prefix', 'app', 'is_active', 'rate_limit', 'last_used', 'created_at')
    list_filter = ('is_active',)
    readonly_fields = ('id', 'key_hash', 'prefix', 'created_at')


@admin.register(Webhook)
class WebhookAdmin(admin.ModelAdmin):
    list_display = ('app', 'url', 'is_active', 'failure_count', 'created_at')
    list_filter = ('is_active',)
    readonly_fields = ('id', 'secret', 'created_at')
    inlines = [WebhookDeliveryInline]


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = ('webhook', 'event', 'success', 'response_status', 'created_at')
    list_filter = ('success', 'event')
    readonly_fields = (
        'id',
        'webhook',
        'event',
        'payload',
        'response_status',
        'response_body',
        'success',
        'created_at',
    )


@admin.register(OAuthAuthorizationCode)
class OAuthAuthorizationCodeAdmin(admin.ModelAdmin):
    list_display = ('app', 'user', 'used', 'expires_at', 'created_at')
    list_filter = ('used',)
    readonly_fields = ('id', 'code', 'created_at')
    search_fields = ('app__name', 'user__username', 'user__email')


@admin.register(OAuthAccessToken)
class OAuthAccessTokenAdmin(admin.ModelAdmin):
    list_display = ('app', 'user', 'is_revoked', 'expires_at', 'created_at')
    list_filter = ('is_revoked',)
    readonly_fields = ('id', 'access_token', 'refresh_token', 'created_at')
    search_fields = ('app__name', 'user__username', 'user__email')
