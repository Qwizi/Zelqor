import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class PlayerProfile(models.Model):
    """Engagement-specific profile tracking XP, levels, streaks, and match stats."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='engagement_profile',
    )
    xp = models.PositiveIntegerField(default=0)
    level = models.PositiveIntegerField(default=1)
    login_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    # Date (not datetime) of last daily claim — used for streak logic
    last_login_date = models.DateField(null=True, blank=True)
    # Exact datetime of the last daily claim
    last_daily_claimed_at = models.DateTimeField(null=True, blank=True)
    total_matches = models.PositiveIntegerField(default=0)
    total_wins = models.PositiveIntegerField(default=0)
    total_playtime_seconds = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Player Profile'
        verbose_name_plural = 'Player Profiles'

    def __str__(self):
        return f'{self.user.username} — Level {self.level} ({self.xp} XP)'

    @classmethod
    def get_or_create_for_user(cls, user):
        """Get or create the engagement profile for the given user."""
        profile, _ = cls.objects.get_or_create(user=user)
        return profile

    @property
    def xp_for_next_level(self) -> int:
        """XP required to advance from current level to next.

        Formula: level * 100 + (level - 1) * 50
        Examples: level 1 -> 100, level 2 -> 250, level 3 -> 400
        """
        return self.level * 100 + (self.level - 1) * 50

    @property
    def xp_progress(self) -> float:
        """Progress toward next level as a float 0.0–1.0."""
        needed = self.xp_for_next_level
        if needed <= 0:
            return 1.0
        return min(1.0, self.xp / needed)

    def add_xp(self, amount: int) -> int:
        """Add XP, handling any number of level-ups.

        Returns the number of levels gained.
        """
        self.xp += amount
        levels_gained = 0
        while self.xp >= self.xp_for_next_level:
            self.xp -= self.xp_for_next_level
            self.level += 1
            levels_gained += 1
        self.save(update_fields=['xp', 'level'])
        return levels_gained


class DailyReward(models.Model):
    """Defines the reward granted on a given streak day (1–7, then cycles)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    day = models.PositiveIntegerField(unique=True, help_text='Streak day number (1-7)')
    gold_reward = models.PositiveIntegerField(default=10)
    xp_reward = models.PositiveIntegerField(default=25)
    # e.g. "Skrzynia dzienna" for day 7
    bonus_description = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['day']
        verbose_name = 'Daily Reward'
        verbose_name_plural = 'Daily Rewards'

    def __str__(self):
        return f'Day {self.day}: {self.gold_reward} gold, {self.xp_reward} XP'


class DailyRewardClaim(models.Model):
    """Log entry for each daily reward claimed by a player."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='daily_claims',
    )
    reward = models.ForeignKey(
        DailyReward,
        on_delete=models.CASCADE,
        related_name='claims',
    )
    streak_day = models.PositiveIntegerField(help_text='The streak count at the time of claim')
    gold_earned = models.PositiveIntegerField(default=0)
    xp_earned = models.PositiveIntegerField(default=0)
    claimed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-claimed_at']
        verbose_name = 'Daily Reward Claim'
        verbose_name_plural = 'Daily Reward Claims'

    def __str__(self):
        return f'{self.user.username} claimed day {self.streak_day} at {self.claimed_at:%Y-%m-%d %H:%M}'


class Quest(models.Model):
    """Template for a quest that can be assigned to players."""

    class QuestType(models.TextChoices):
        DAILY = 'daily', 'Daily'
        WEEKLY = 'weekly', 'Weekly'
        SPECIAL = 'special', 'Special'

    class ObjectiveType(models.TextChoices):
        PLAY_MATCHES = 'play_matches', 'Play Matches'
        WIN_MATCHES = 'win_matches', 'Win Matches'
        CONQUER_REGIONS = 'conquer_regions', 'Conquer Regions'
        BUILD_BUILDINGS = 'build_buildings', 'Build Buildings'
        PRODUCE_UNITS = 'produce_units', 'Produce Units'
        EARN_GOLD = 'earn_gold', 'Earn Gold'
        LOGIN_STREAK = 'login_streak', 'Login Streak'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quest_type = models.CharField(max_length=10, choices=QuestType.choices)
    title = models.CharField(max_length=200)
    description = models.TextField()
    objective_type = models.CharField(max_length=30, choices=ObjectiveType.choices)
    objective_count = models.PositiveIntegerField(help_text='How many to complete')
    gold_reward = models.PositiveIntegerField(default=0)
    xp_reward = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['quest_type', 'title']
        verbose_name = 'Quest'
        verbose_name_plural = 'Quests'

    def __str__(self):
        return f'[{self.get_quest_type_display()}] {self.title}'


class PlayerQuest(models.Model):
    """A quest instance assigned to a specific player."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quests',
    )
    quest = models.ForeignKey(
        Quest,
        on_delete=models.CASCADE,
        related_name='player_quests',
    )
    progress = models.PositiveIntegerField(default=0)
    is_completed = models.BooleanField(default=False)
    is_claimed = models.BooleanField(default=False, help_text='Whether the reward has been claimed')
    assigned_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('user', 'quest')
        ordering = ['is_claimed', 'is_completed', '-assigned_at']
        verbose_name = 'Player Quest'
        verbose_name_plural = 'Player Quests'

    def __str__(self):
        status = 'claimed' if self.is_claimed else ('done' if self.is_completed else 'active')
        return f'{self.user.username}: {self.quest.title} [{status}]'

    @property
    def is_expired(self) -> bool:
        """True if expires_at is set and is in the past."""
        if self.expires_at is None:
            return False
        return self.expires_at < timezone.now()


class Achievement(models.Model):
    """Definition of an achievement that players can unlock."""

    class Rarity(models.TextChoices):
        COMMON = 'common', 'Common'
        UNCOMMON = 'uncommon', 'Uncommon'
        RARE = 'rare', 'Rare'
        EPIC = 'epic', 'Epic'
        LEGENDARY = 'legendary', 'Legendary'

    OBJECTIVE_TYPE_CHOICES = Quest.ObjectiveType.choices

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField()
    icon = models.CharField(max_length=50, blank=True)
    objective_type = models.CharField(max_length=50, choices=OBJECTIVE_TYPE_CHOICES)
    objective_count = models.PositiveIntegerField()
    gold_reward = models.PositiveIntegerField(default=0)
    xp_reward = models.PositiveIntegerField(default=0)
    rarity = models.CharField(max_length=20, choices=Rarity.choices, default=Rarity.COMMON)
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'title']
        verbose_name = 'Achievement'
        verbose_name_plural = 'Achievements'

    def __str__(self):
        return f'{self.title} ({self.get_rarity_display()})'


class PlayerAchievement(models.Model):
    """Record of an achievement unlocked by a player."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='achievements',
    )
    achievement = models.ForeignKey(
        Achievement,
        on_delete=models.CASCADE,
        related_name='unlocked_by',
    )
    unlocked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'achievement')
        ordering = ['-unlocked_at']
        verbose_name = 'Player Achievement'
        verbose_name_plural = 'Player Achievements'

    def __str__(self):
        return f'{self.user.username} unlocked "{self.achievement.title}"'
