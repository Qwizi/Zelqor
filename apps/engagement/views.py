import logging
from datetime import date, datetime

from django.db import transaction
from ninja_extra import api_controller, route

from apps.accounts.auth import ActiveUserJWTAuth
from apps.engagement.models import (
    Achievement,
    DailyReward,
    DailyRewardClaim,
    PlayerAchievement,
    PlayerProfile,
    PlayerQuest,
)
from apps.engagement.schemas import (
    AchievementOut,
    ClaimDailyOut,
    ClaimQuestOut,
    DailyRewardOut,
    DailyStatusOut,
    EngagementSummaryOut,
    PlayerProfileOut,
    QuestOut,
)

logger = logging.getLogger(__name__)


def _build_profile_out(profile: PlayerProfile) -> PlayerProfileOut:
    return PlayerProfileOut(
        xp=profile.xp,
        level=profile.level,
        xp_for_next_level=profile.xp_for_next_level,
        xp_progress=profile.xp_progress,
        login_streak=profile.login_streak,
        best_streak=profile.best_streak,
        last_daily_claimed_at=profile.last_daily_claimed_at,
        total_matches=profile.total_matches,
        total_wins=profile.total_wins,
        total_playtime_seconds=profile.total_playtime_seconds,
    )


def _build_daily_status(profile: PlayerProfile) -> DailyStatusOut:
    today = date.today()
    last = profile.last_login_date
    can_claim = last != today

    all_rewards = list(DailyReward.objects.filter(is_active=True).order_by('day'))
    current_streak = profile.login_streak

    # Which streak day will be awarded on next claim?
    next_streak = current_streak + 1 if (can_claim and last is not None) else 1
    if can_claim and last is not None:
        delta = (today - last).days
        if delta > 1:
            # Streak will reset
            next_streak = 1

    next_day_num = (next_streak - 1) % 7 + 1

    reward_outs = []
    next_reward_out = None
    for r in all_rewards:
        is_today = can_claim and (r.day == next_day_num)
        out = DailyRewardOut(
            day=r.day,
            gold_reward=r.gold_reward,
            xp_reward=r.xp_reward,
            bonus_description=r.bonus_description,
            is_today=is_today,
        )
        reward_outs.append(out)
        if is_today:
            next_reward_out = out

    return DailyStatusOut(
        can_claim=can_claim,
        current_streak=current_streak,
        next_reward=next_reward_out,
        rewards=reward_outs,
        last_claimed_at=profile.last_daily_claimed_at,
    )


def _build_quest_out(pq: PlayerQuest) -> QuestOut:
    return QuestOut(
        id=str(pq.id),
        title=pq.quest.title,
        description=pq.quest.description,
        objective_type=pq.quest.objective_type,
        objective_count=pq.quest.objective_count,
        progress=pq.progress,
        gold_reward=pq.quest.gold_reward,
        xp_reward=pq.quest.xp_reward,
        is_completed=pq.is_completed,
        is_claimed=pq.is_claimed,
        quest_type=pq.quest.quest_type,
        expires_at=pq.expires_at,
    )


def _build_achievement_out(achievement: Achievement, unlocked_at: datetime | None) -> AchievementOut:
    return AchievementOut(
        id=str(achievement.id),
        slug=achievement.slug,
        title=achievement.title,
        description=achievement.description,
        icon=achievement.icon,
        objective_type=achievement.objective_type,
        objective_count=achievement.objective_count,
        gold_reward=achievement.gold_reward,
        xp_reward=achievement.xp_reward,
        rarity=achievement.rarity,
        is_unlocked=unlocked_at is not None,
        unlocked_at=unlocked_at,
    )


def models_expires_filter(now):
    """Return a Q object for non-expired quests."""
    from django.db.models import Q
    return Q(expires_at__isnull=True) | Q(expires_at__gt=now)


@api_controller('/engagement', tags=['Engagement'])
class EngagementController:

    @route.get('/summary/', response=EngagementSummaryOut, auth=ActiveUserJWTAuth())
    def get_summary(self, request):
        """Return all engagement data in a single call."""
        user = request.user
        profile = PlayerProfile.get_or_create_for_user(user)

        daily_status = _build_daily_status(profile)

        from django.utils import timezone as dj_tz
        active_pqs = list(
            PlayerQuest.objects
            .filter(user=user, is_claimed=False)
            .filter(models_expires_filter(dj_tz.now()))
            .select_related('quest')
            .order_by('is_completed', '-assigned_at')
        )
        quest_outs = [_build_quest_out(pq) for pq in active_pqs]

        all_achievements = list(Achievement.objects.filter(is_active=True).order_by('order', 'title'))
        unlocked_map = {
            pa.achievement_id: pa.unlocked_at
            for pa in PlayerAchievement.objects.filter(user=user)
        }
        recent_achievements = [
            _build_achievement_out(a, unlocked_map.get(a.id))
            for a in all_achievements
        ]

        return EngagementSummaryOut(
            profile=_build_profile_out(profile),
            daily=daily_status,
            active_quests=quest_outs,
            recent_achievements=recent_achievements,
        )

    @route.get('/profile/', response=PlayerProfileOut, auth=ActiveUserJWTAuth())
    def get_profile(self, request):
        """Return the current user's engagement profile."""
        profile = PlayerProfile.get_or_create_for_user(request.user)
        return _build_profile_out(profile)

    @route.get('/daily/', response=DailyStatusOut, auth=ActiveUserJWTAuth())
    def get_daily_status(self, request):
        """Return current daily reward status and streak info."""
        profile = PlayerProfile.get_or_create_for_user(request.user)
        return _build_daily_status(profile)

    @route.post('/daily/claim/', response=ClaimDailyOut, auth=ActiveUserJWTAuth())
    def claim_daily(self, request):
        """Claim today's daily reward and update login streak."""
        from django.utils import timezone
        from apps.inventory.models import Wallet

        user = request.user
        today = date.today()

        with transaction.atomic():
            profile = PlayerProfile.objects.select_for_update().get_or_create(user=user)[0]

            last = profile.last_login_date
            if last == today:
                return self.create_response(
                    {'detail': 'Dzienna nagroda została już odebrana.'},
                    status_code=400,
                )

            if last is not None:
                delta = (today - last).days
                if delta == 1:
                    # Consecutive day — continue streak
                    profile.login_streak += 1
                else:
                    # Gap — reset streak
                    profile.login_streak = 1
            else:
                profile.login_streak = 1

            if profile.login_streak > profile.best_streak:
                profile.best_streak = profile.login_streak

            profile.last_login_date = today
            profile.last_daily_claimed_at = timezone.now()

            # Pick reward for this streak day (cycles every 7)
            day_num = (profile.login_streak - 1) % 7 + 1
            try:
                reward = DailyReward.objects.get(day=day_num, is_active=True)
            except DailyReward.DoesNotExist:
                return self.create_response(
                    {'detail': f'Nagroda dla dnia {day_num} nie jest skonfigurowana.'},
                    status_code=500,
                )

            # Credit gold
            wallet, _ = Wallet.objects.get_or_create(user=user)
            wallet.gold += reward.gold_reward
            wallet.total_earned += reward.gold_reward
            wallet.save(update_fields=['gold', 'total_earned', 'updated_at'])

            # Credit XP
            levels_gained = profile.add_xp(reward.xp_reward)

            # Save profile (add_xp already saves xp/level; save streak fields too)
            profile.save(update_fields=[
                'login_streak', 'best_streak',
                'last_login_date', 'last_daily_claimed_at',
            ])

            # Record claim
            DailyRewardClaim.objects.create(
                user=user,
                reward=reward,
                streak_day=profile.login_streak,
                gold_earned=reward.gold_reward,
                xp_earned=reward.xp_reward,
            )

        return ClaimDailyOut(
            gold_earned=reward.gold_reward,
            xp_earned=reward.xp_reward,
            new_streak=profile.login_streak,
            levels_gained=levels_gained,
            new_level=profile.level,
        )

    @route.get('/quests/', response=list[QuestOut], auth=ActiveUserJWTAuth())
    def list_quests(self, request):
        """Return active (non-expired, non-claimed) player quests."""
        from django.utils import timezone
        now = timezone.now()
        pqs = (
            PlayerQuest.objects
            .filter(user=request.user, is_claimed=False)
            .filter(models_expires_filter(now))
            .select_related('quest')
            .order_by('is_completed', '-assigned_at')
        )
        return [_build_quest_out(pq) for pq in pqs]

    @route.post('/quests/{quest_id}/claim/', response=ClaimQuestOut, auth=ActiveUserJWTAuth())
    def claim_quest(self, request, quest_id: str):
        """Claim the reward for a completed quest."""
        from apps.inventory.models import Wallet

        user = request.user

        with transaction.atomic():
            try:
                pq = PlayerQuest.objects.select_for_update().select_related('quest').get(
                    id=quest_id, user=user,
                )
            except PlayerQuest.DoesNotExist:
                return self.create_response({'detail': 'Zadanie nie znalezione.'}, status_code=404)

            if not pq.is_completed:
                return self.create_response(
                    {'detail': 'Zadanie nie zostało ukończone.'},
                    status_code=400,
                )
            if pq.is_claimed:
                return self.create_response(
                    {'detail': 'Nagroda za to zadanie została już odebrana.'},
                    status_code=400,
                )

            quest = pq.quest
            wallet, _ = Wallet.objects.get_or_create(user=user)
            wallet.gold += quest.gold_reward
            wallet.total_earned += quest.gold_reward
            wallet.save(update_fields=['gold', 'total_earned', 'updated_at'])

            profile = PlayerProfile.get_or_create_for_user(user)
            levels_gained = profile.add_xp(quest.xp_reward)

            pq.is_claimed = True
            pq.save(update_fields=['is_claimed'])

        return ClaimQuestOut(
            gold_earned=quest.gold_reward,
            xp_earned=quest.xp_reward,
            levels_gained=levels_gained,
            new_level=profile.level,
        )

    @route.get('/achievements/', response=list[AchievementOut], auth=ActiveUserJWTAuth())
    def list_achievements(self, request):
        """Return all achievements with unlock status for the current user."""
        user = request.user
        all_achievements = list(Achievement.objects.filter(is_active=True).order_by('order', 'title'))
        unlocked_map = {
            pa.achievement_id: pa.unlocked_at
            for pa in PlayerAchievement.objects.filter(user=user)
        }
        return [
            _build_achievement_out(a, unlocked_map.get(a.id))
            for a in all_achievements
        ]
