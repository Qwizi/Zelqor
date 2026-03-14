import uuid

from django.conf import settings
from django.db import models


class ChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='chat_messages',
    )
    content = models.TextField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.user_id} @ {self.created_at}: {self.content[:40]}'


class MatchChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    match = models.ForeignKey(
        'matchmaking.Match',
        on_delete=models.CASCADE,
        related_name='chat_messages',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='match_chat_messages',
    )
    content = models.TextField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'match={self.match_id} user={self.user_id} @ {self.created_at}: {self.content[:40]}'
