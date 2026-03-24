from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.chat.models import ChatMessage, MatchChatMessage


@admin.register(ChatMessage)
class ChatMessageAdmin(ModelAdmin):
    list_display = ("id", "user", "content", "created_at")
    list_select_related = ("user",)
    list_fullwidth = True
    readonly_fields = ("id", "created_at")
    ordering = ("-created_at",)


@admin.register(MatchChatMessage)
class MatchChatMessageAdmin(ModelAdmin):
    list_display = ("id", "match", "user", "content", "created_at")
    list_select_related = ("match", "user")
    list_fullwidth = True
    readonly_fields = ("id", "created_at")
    ordering = ("-created_at",)
