from django.contrib import admin

from apps.chat.models import ChatMessage, MatchChatMessage


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'content', 'created_at')
    list_select_related = ('user',)
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)


@admin.register(MatchChatMessage)
class MatchChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'match', 'user', 'content', 'created_at')
    list_select_related = ('match', 'user')
    readonly_fields = ('id', 'created_at')
    ordering = ('-created_at',)
