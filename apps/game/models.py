import secrets
import uuid

from django.conf import settings
from django.db import models


class GameStateSnapshot(models.Model):
    """Periodic snapshots of game state from Redis → PostgreSQL for history/replay.

    State is stored zstd-compressed in ``compressed_state`` for ~90% storage
    savings.  The legacy ``state_data`` JSONField is kept nullable for backward
    compatibility with existing rows; new writes always go to the compressed
    column.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    match = models.ForeignKey("matchmaking.Match", on_delete=models.CASCADE, related_name="snapshots")
    tick = models.PositiveIntegerField()
    state_data = models.JSONField(
        null=True,
        blank=True,
        default=None,
        help_text="Legacy uncompressed state (nullable, new snapshots use compressed_state)",
    )
    compressed_state = models.BinaryField(
        null=True,
        blank=True,
        help_text="zstd-compressed JSON game state (~90% smaller than JSONField)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["match", "tick"]
        unique_together = ("match", "tick")

    def __str__(self):
        return f"Snapshot {self.match_id} tick {self.tick}"

    def get_state(self) -> dict:
        """Return decompressed state dict, reading from compressed or legacy field."""
        import json

        if self.compressed_state:
            import zstandard

            data = zstandard.decompress(bytes(self.compressed_state))
            return json.loads(data)
        return self.state_data or {}

    def set_state(self, state: dict) -> None:
        """Compress and store state, clearing the legacy field."""
        import json

        import zstandard

        json_bytes = json.dumps(state, separators=(",", ":")).encode()
        self.compressed_state = zstandard.compress(json_bytes, 3)
        self.state_data = None


class MatchResult(models.Model):
    """Post-match statistics and results."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    match = models.OneToOneField("matchmaking.Match", on_delete=models.CASCADE, related_name="result")
    duration_seconds = models.PositiveIntegerField(default=0)
    total_ticks = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-match__created_at"]

    def __str__(self):
        return f"Result for {self.match_id}"


class PlayerResult(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    match_result = models.ForeignKey(MatchResult, on_delete=models.CASCADE, related_name="player_results")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="game_results")
    placement = models.PositiveIntegerField(default=0, help_text="1=winner, 2=second, etc.")
    regions_conquered = models.PositiveIntegerField(default=0)
    units_produced = models.PositiveIntegerField(default=0)
    units_lost = models.PositiveIntegerField(default=0)
    buildings_built = models.PositiveIntegerField(default=0)
    elo_change = models.IntegerField(default=0)

    class Meta:
        ordering = ["placement"]
        unique_together = ("match_result", "user")

    def __str__(self):
        return f"{self.user.username} - #{self.placement} in {self.match_result.match_id}"


class ShareLink(models.Model):
    """Generic share link for any shareable resource (e.g. match results)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.CharField(max_length=32, unique=True, db_index=True)
    resource_type = models.CharField(max_length=50)  # e.g. "match_result"
    resource_id = models.UUIDField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="share_links",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("resource_type", "resource_id")

    def __str__(self):
        return f"ShareLink {self.token} ({self.resource_type}:{self.resource_id})"

    @classmethod
    def generate_token(cls):
        return secrets.token_urlsafe(16)


class AnticheatViolation(models.Model):
    """Records anti-cheat violations detected by the Rust gateway."""

    SEVERITY_CHOICES = [
        ("warn", "Warning"),
        ("flag", "Flagged"),
        ("ban", "Banned"),
    ]

    match = models.ForeignKey(
        "matchmaking.Match",
        on_delete=models.CASCADE,
        related_name="anticheat_violations",
    )
    player = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="anticheat_violations",
    )
    violation_kind = models.CharField(max_length=50)  # action_flood, impossible_timing, etc.
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES)
    detail = models.TextField()
    tick = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.violation_kind} ({self.severity}) - {self.player} in match {self.match_id}"
