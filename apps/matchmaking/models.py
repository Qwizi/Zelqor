import uuid
from django.conf import settings
from django.db import models


class Match(models.Model):
    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting for players'
        SELECTING = 'selecting', 'Capital selection'
        IN_PROGRESS = 'in_progress', 'In Progress'
        FINISHED = 'finished', 'Finished'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.WAITING, db_index=True)
    game_mode = models.ForeignKey(
        'game_config.GameMode', on_delete=models.PROTECT, related_name='matches',
        null=True, blank=True,
    )
    map_config = models.ForeignKey(
        'game_config.MapConfig', on_delete=models.PROTECT, related_name='matches',
        null=True, blank=True,
    )
    max_players = models.PositiveIntegerField(default=2)
    winner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='won_matches',
    )
    settings_snapshot = models.JSONField(default=dict, blank=True, help_text='Snapshot of GameSettings at match start')
    is_tutorial = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'matches'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at'], name='match_status_created_idx'),
        ]

    def __str__(self):
        return f"Match {self.id} ({self.get_status_display()})"


class MatchPlayer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name='players')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='match_players')
    color = models.CharField(max_length=7, default='#FF0000')
    is_alive = models.BooleanField(default=True)
    capital_region = models.ForeignKey(
        'geo.Region', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='capital_of',
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    eliminated_at = models.DateTimeField(null=True, blank=True)
    deck_snapshot = models.JSONField(
        default=dict, blank=True,
        help_text='Snapshot of deck items consumed for this match',
    )
    cosmetic_snapshot = models.JSONField(
        default=dict, blank=True,
        help_text='Frozen cosmetic overrides: {asset_key: asset_url}',
    )
    team_label = models.CharField(
        max_length=32, blank=True, null=True,
        help_text='Team identifier for team-based modes (e.g. "challenger", "defender"). Null for free-for-all.',
    )

    class Meta:
        unique_together = ('match', 'user')
        ordering = ['joined_at']
        indexes = [
            models.Index(fields=['match', 'user', 'is_alive'], name='mp_match_user_alive_idx'),
        ]

    def __str__(self):
        return f"{self.user.username} in {self.match_id}"


class MatchQueue(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='queue_entry')
    game_mode = models.ForeignKey(
        'game_config.GameMode', on_delete=models.CASCADE, related_name='queue_entries',
        null=True, blank=True,
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['joined_at']

    def __str__(self):
        return f"{self.user.username} (queued at {self.joined_at})"


class Lobby(models.Model):
    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting for players'
        FULL = 'full', 'Full'
        READY = 'ready', 'All ready'
        STARTING = 'starting', 'Starting match'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_mode = models.ForeignKey(
        'game_config.GameMode', on_delete=models.SET_NULL,
        related_name='lobbies', null=True, blank=True,
    )
    host_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='hosted_lobbies',
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.WAITING, db_index=True)
    max_players = models.PositiveIntegerField(default=2)
    match = models.OneToOneField(
        'matchmaking.Match', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='lobby',
    )
    full_at = models.DateTimeField(null=True, blank=True, help_text='When lobby became full (for ready timeout)')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'lobbies'
        ordering = ['-created_at']

    def __str__(self):
        return f"Lobby {self.id} ({self.get_status_display()})"


class LobbyPlayer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lobby = models.ForeignKey(Lobby, on_delete=models.CASCADE, related_name='players')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='lobby_players')
    is_ready = models.BooleanField(default=False)
    is_bot = models.BooleanField(default=False)
    joined_at = models.DateTimeField(auto_now_add=True)
    team_label = models.CharField(
        max_length=32, blank=True, null=True,
        help_text='Team identifier for team-based modes (e.g. "challenger", "defender"). Null for free-for-all.',
    )

    class Meta:
        unique_together = ('lobby', 'user')
        ordering = ['joined_at']

    def __str__(self):
        return f"{self.user.username} in Lobby {self.lobby_id}"
