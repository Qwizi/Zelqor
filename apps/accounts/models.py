import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


_game_redis_client = None

def _get_game_redis():
    """Get Redis client for game DB (same DB as Rust gateway)."""
    global _game_redis_client
    if _game_redis_client is None:
        import redis as redis_lib
        from django.conf import settings
        _game_redis_client = redis_lib.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_GAME_DB,
            decode_responses=True,
        )
    return _game_redis_client

def _get_player_status_from_redis(user_id):
    """Read real-time player status from Redis. Returns dict or None.

    Possible return values:
    - {"status": "in_queue", "game_mode": "standard-1v1"}
    - {"status": "in_game", "match_id": "..."}
    - None (no status / offline)
    """
    try:
        import json
        r = _get_game_redis()
        raw = r.get(f"player:status:{user_id}")
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return None


class User(AbstractUser):
    class Role(models.TextChoices):
        USER = 'user', 'User'
        ADMIN = 'admin', 'Admin'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.USER)
    elo_rating = models.IntegerField(default=1000)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    is_bot = models.BooleanField(default=False)
    tutorial_completed = models.BooleanField(default=False)
    is_banned = models.BooleanField(default=False)
    banned_reason = models.TextField(blank=True, default='')
    last_active = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self):
        return self.email

    @property
    def is_admin(self):
        return self.role == self.Role.ADMIN

    @property
    def is_online(self):
        if not self.last_active:
            return False
        from django.utils import timezone
        return (timezone.now() - self.last_active).total_seconds() < 120

    @property
    def activity_status(self):
        """Returns: 'in_game', 'in_queue', 'online', or 'offline'."""
        data = _get_player_status_from_redis(self.pk)
        if data and isinstance(data, dict):
            return data.get('status', 'online')
        if self.is_online:
            return 'online'
        return 'offline'

    @property
    def activity_details(self):
        """Returns full status dict from Redis, or empty dict."""
        data = _get_player_status_from_redis(self.pk)
        if data and isinstance(data, dict):
            return data
        return {}


class SocialAccount(models.Model):
    class Provider(models.TextChoices):
        GOOGLE = 'google', 'Google'
        DISCORD = 'discord', 'Discord'
        STEAM = 'steam', 'Steam'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='social_accounts')
    provider = models.CharField(max_length=20, choices=Provider.choices)
    provider_user_id = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default='')
    display_name = models.CharField(max_length=255, blank=True, default='')
    avatar_url = models.URLField(max_length=500, blank=True, default='')
    access_token = models.TextField(blank=True, default='')
    refresh_token = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('provider', 'provider_user_id')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.provider}:{self.provider_user_id} -> {self.user.email}"


class PushSubscription(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='push_subscriptions')
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} - {self.endpoint[:50]}"

    def to_webpush_dict(self):
        return {
            "endpoint": self.endpoint,
            "keys": {
                "p256dh": self.p256dh,
                "auth": self.auth,
            },
        }


class DirectMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    receiver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_messages')
    content = models.TextField(max_length=500)
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['sender', 'receiver', '-created_at']),
        ]

    def __str__(self):
        return f"{self.sender.username} \u2192 {self.receiver.username}: {self.content[:30]}"


class Friendship(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='friendships_sent')
    to_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='friendships_received')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('from_user', 'to_user')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.from_user} \u2192 {self.to_user} ({self.status})"
