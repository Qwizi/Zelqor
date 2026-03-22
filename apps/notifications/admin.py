from django.contrib import admin
from unfold.admin import ModelAdmin
from apps.notifications.models import Notification


@admin.register(Notification)
class NotificationAdmin(ModelAdmin):
    list_display = ('user', 'type', 'title', 'is_read', 'created_at')
    list_filter = ('type', 'is_read')
    search_fields = ('user__username', 'title')
    raw_id_fields = ('user',)
    readonly_fields = ('created_at',)
