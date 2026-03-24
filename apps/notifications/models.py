import uuid

from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        FRIEND_REQUEST_RECEIVED = "friend_request_received"
        FRIEND_REQUEST_ACCEPTED = "friend_request_accepted"
        MATCH_WON = "match_won"
        MATCH_LOST = "match_lost"
        PLAYER_ELIMINATED = "player_eliminated"
        GAME_INVITE = "game_invite"
        # Clan notifications
        CLAN_INVITATION_RECEIVED = "clan_invitation_received"
        CLAN_JOIN_REQUEST = "clan_join_request"
        CLAN_JOIN_REQUEST_ACCEPTED = "clan_join_request_accepted"
        CLAN_MEMBER_JOINED = "clan_member_joined"
        CLAN_MEMBER_LEFT = "clan_member_left"
        CLAN_WAR_DECLARED = "clan_war_declared"
        CLAN_WAR_RESULT = "clan_war_result"
        CLAN_PROMOTED = "clan_promoted"
        CLAN_DEMOTED = "clan_demoted"
        CLAN_KICKED = "clan_kicked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=40, choices=Type.choices)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    data = models.JSONField(default=dict, blank=True)
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_read", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.type} -> {self.user.username}"
