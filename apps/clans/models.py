import uuid
from django.conf import settings
from django.db import models


class Clan(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=32, unique=True)
    tag = models.CharField(max_length=5, unique=True)
    description = models.TextField(max_length=500, blank=True, default='')
    badge = models.ImageField(upload_to='clans/badges/', blank=True)
    color = models.CharField(max_length=7, default='#FFFFFF')

    leader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='led_clans',
    )
    level = models.PositiveIntegerField(default=1)
    experience = models.PositiveIntegerField(default=0)
    elo_rating = models.IntegerField(default=1000)

    max_members = models.PositiveIntegerField(default=10)
    is_recruiting = models.BooleanField(default=True)
    is_public = models.BooleanField(default=True)

    # Treasury
    treasury_gold = models.PositiveIntegerField(default=0)
    tax_percent = models.DecimalField(max_digits=4, decimal_places=1, default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    dissolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'[{self.tag}] {self.name}'

    @property
    def member_count(self):
        return self.memberships.count()


class ClanMembership(models.Model):
    class Role(models.TextChoices):
        LEADER = 'leader', 'Leader'
        OFFICER = 'officer', 'Officer'
        MEMBER = 'member', 'Member'
        RECRUIT = 'recruit', 'Recruit'

    ROLE_HIERARCHY = {
        Role.LEADER: 4,
        Role.OFFICER: 3,
        Role.MEMBER: 2,
        Role.RECRUIT: 1,
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clan = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='memberships')
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clan_membership',
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.RECRUIT)
    joined_at = models.DateTimeField(auto_now_add=True)
    contributions_gold = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('clan', 'user')]

    def __str__(self):
        return f'{self.user} in [{self.clan.tag}] as {self.role}'

    @property
    def rank(self):
        return self.ROLE_HIERARCHY.get(self.role, 0)


class ClanInvitation(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        DECLINED = 'declined', 'Declined'
        EXPIRED = 'expired', 'Expired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clan = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='invitations')
    invited_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clan_invitations',
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_clan_invitations',
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['invited_user', 'status', '-created_at']),
        ]

    def __str__(self):
        return f'Invite {self.invited_user} to [{self.clan.tag}] ({self.status})'


class ClanJoinRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        DECLINED = 'declined', 'Declined'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clan = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='join_requests')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clan_join_requests',
    )
    message = models.TextField(max_length=200, blank=True, default='')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['clan', 'status', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user} wants to join [{self.clan.tag}] ({self.status})'


class ClanActivityLog(models.Model):
    class Action(models.TextChoices):
        MEMBER_JOINED = 'member_joined'
        MEMBER_LEFT = 'member_left'
        MEMBER_KICKED = 'member_kicked'
        MEMBER_PROMOTED = 'member_promoted'
        MEMBER_DEMOTED = 'member_demoted'
        GOLD_DONATED = 'gold_donated'
        GOLD_WITHDRAWN = 'gold_withdrawn'
        SETTINGS_CHANGED = 'settings_changed'
        WAR_DECLARED = 'war_declared'
        WAR_WON = 'war_won'
        WAR_LOST = 'war_lost'
        CLAN_LEVELED_UP = 'clan_leveled_up'
        LEADER_TRANSFERRED = 'leader_transferred'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clan = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='activity_logs')
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='+',
    )
    action = models.CharField(max_length=30, choices=Action.choices)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['clan', '-created_at']),
        ]

    def __str__(self):
        return f'[{self.clan.tag}] {self.action} by {self.actor}'


class ClanLevel(models.Model):
    level = models.PositiveIntegerField(unique=True, primary_key=True)
    experience_required = models.PositiveIntegerField()
    max_members = models.PositiveIntegerField()
    treasury_cap = models.PositiveIntegerField()
    perks = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['level']

    def __str__(self):
        return f'Clan Level {self.level} (XP: {self.experience_required})'


class ClanChatMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clan = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='chat_messages')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clan_chat_messages',
    )
    content = models.TextField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'[{self.clan.tag}] {self.user} @ {self.created_at}: {self.content[:40]}'


class ClanWar(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        IN_PROGRESS = 'in_progress', 'In Progress'
        FINISHED = 'finished', 'Finished'
        DECLINED = 'declined', 'Declined'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    challenger = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='wars_as_challenger')
    defender = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='wars_as_defender')
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PENDING)
    match = models.OneToOneField(
        'matchmaking.Match',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='clan_war',
    )

    winner = models.ForeignKey(
        Clan,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='wars_won',
    )
    challenger_elo_change = models.IntegerField(default=0)
    defender_elo_change = models.IntegerField(default=0)

    players_per_side = models.PositiveIntegerField(default=3)
    wager_gold = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at']),
        ]

    def __str__(self):
        return f'[{self.challenger.tag}] vs [{self.defender.tag}] ({self.status})'


class ClanWarParticipant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    war = models.ForeignKey(ClanWar, on_delete=models.CASCADE, related_name='participants')
    clan = models.ForeignKey(Clan, on_delete=models.CASCADE, related_name='+')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clan_war_participations',
    )

    class Meta:
        unique_together = [('war', 'user')]

    def __str__(self):
        return f'{self.user} in war {self.war_id} for [{self.clan.tag}]'
