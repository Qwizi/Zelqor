import logging
import random
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


def _end_of_day_utc() -> timezone.datetime:
    """Return the end of the current UTC day (23:59:59.999999)."""
    now = timezone.now()
    return now.replace(hour=23, minute=59, second=59, microsecond=999999)


def _end_of_week_utc() -> timezone.datetime:
    """Return the end of the current ISO week (Sunday 23:59:59 UTC)."""
    now = timezone.now()
    days_until_sunday = 6 - now.weekday()  # weekday(): Mon=0, Sun=6
    end_of_week = now + timedelta(days=days_until_sunday)
    return end_of_week.replace(hour=23, minute=59, second=59, microsecond=999999)


@shared_task
def assign_daily_quests():
    """Assign 3 random active daily quests to users active in the last 7 days.

    Idempotent: skips users who already have unclaimed daily quests expiring today.
    """
    from apps.accounts.models import User
    from apps.engagement.models import PlayerQuest, Quest

    cutoff = timezone.now() - timedelta(days=7)
    active_users = User.objects.filter(
        last_login__gte=cutoff,
        is_active=True,
        is_bot=False,
    )

    daily_quests = list(Quest.objects.filter(quest_type='daily', is_active=True))
    if not daily_quests:
        logger.info('No active daily quests to assign.')
        return

    end_of_day = _end_of_day_utc()
    assigned_count = 0

    for user in active_users:
        # Check if user already has unclaimed daily quests expiring today (or later today)
        existing = PlayerQuest.objects.filter(
            user=user,
            quest__quest_type='daily',
            is_claimed=False,
            expires_at__gte=timezone.now().replace(hour=0, minute=0, second=0, microsecond=0),
        ).exists()
        if existing:
            continue

        # Assign up to 3 random quests the user doesn't already have assigned
        already_assigned_ids = set(
            PlayerQuest.objects.filter(user=user, quest__quest_type='daily')
            .values_list('quest_id', flat=True)
        )
        eligible = [q for q in daily_quests if q.id not in already_assigned_ids]
        if not eligible:
            eligible = daily_quests  # fallback: re-assign if all are used

        chosen = random.sample(eligible, min(3, len(eligible)))
        for quest in chosen:
            PlayerQuest.objects.get_or_create(
                user=user,
                quest=quest,
                defaults={'expires_at': end_of_day},
            )
        assigned_count += len(chosen)

    logger.info('Assigned %d daily quest(s) across active users.', assigned_count)


@shared_task
def assign_weekly_quests():
    """Assign up to 2 random active weekly quests to users active in the last 7 days.

    Idempotent: skips users who already have unclaimed weekly quests for this week.
    """
    from apps.accounts.models import User
    from apps.engagement.models import PlayerQuest, Quest

    cutoff = timezone.now() - timedelta(days=7)
    active_users = User.objects.filter(
        last_login__gte=cutoff,
        is_active=True,
        is_bot=False,
    )

    weekly_quests = list(Quest.objects.filter(quest_type='weekly', is_active=True))
    if not weekly_quests:
        logger.info('No active weekly quests to assign.')
        return

    end_of_week = _end_of_week_utc()
    week_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=timezone.now().weekday()
    )
    assigned_count = 0

    for user in active_users:
        existing = PlayerQuest.objects.filter(
            user=user,
            quest__quest_type='weekly',
            is_claimed=False,
            expires_at__gte=week_start,
        ).exists()
        if existing:
            continue

        already_assigned_ids = set(
            PlayerQuest.objects.filter(user=user, quest__quest_type='weekly')
            .values_list('quest_id', flat=True)
        )
        eligible = [q for q in weekly_quests if q.id not in already_assigned_ids]
        if not eligible:
            eligible = weekly_quests

        chosen = random.sample(eligible, min(2, len(eligible)))
        for quest in chosen:
            PlayerQuest.objects.get_or_create(
                user=user,
                quest=quest,
                defaults={'expires_at': end_of_week},
            )
        assigned_count += len(chosen)

    logger.info('Assigned %d weekly quest(s) across active users.', assigned_count)


@shared_task
def process_match_engagement(match_id: str):
    """Process engagement rewards after a match finishes.

    For each human player:
    - Increments total_matches / total_wins on their PlayerProfile
    - Awards XP: 50 base + 100 for win + 10 per region conquered
    - Awards gold: 20 base + 50 for win
    - Updates quest progress for relevant objective types
    - Checks and unlocks achievements
    """
    from apps.matchmaking.models import Match
    from apps.game.models import PlayerResult, MatchResult
    from apps.engagement.models import PlayerProfile
    from apps.inventory.models import Wallet

    try:
        match = Match.objects.get(id=match_id)
    except Match.DoesNotExist:
        logger.error('process_match_engagement: Match %s not found.', match_id)
        return

    try:
        result = MatchResult.objects.get(match=match)
    except MatchResult.DoesNotExist:
        logger.warning(
            'process_match_engagement: MatchResult for %s not yet available.',
            match_id,
        )
        return

    player_results = list(
        PlayerResult.objects.filter(match_result=result)
        .select_related('user')
    )
    winner_id = str(match.winner_id) if match.winner_id else None

    for pr in player_results:
        user = pr.user
        if user.is_bot:
            continue

        is_winner = str(user.id) == winner_id
        regions_conquered = pr.regions_conquered or 0

        with transaction.atomic():
            profile = PlayerProfile.get_or_create_for_user(user)
            profile = PlayerProfile.objects.select_for_update().get(pk=profile.pk)

            profile.total_matches += 1
            if is_winner:
                profile.total_wins += 1

            duration = result.duration_seconds or 0
            profile.total_playtime_seconds += duration
            profile.save(update_fields=['total_matches', 'total_wins', 'total_playtime_seconds'])

            # XP
            xp_amount = 50 + (100 if is_winner else 0) + (regions_conquered * 10)
            profile.add_xp(xp_amount)

            # Gold
            gold_amount = 20 + (50 if is_winner else 0)
            wallet, _ = Wallet.objects.get_or_create(user=user)
            wallet.gold += gold_amount
            wallet.total_earned += gold_amount
            wallet.save(update_fields=['gold', 'total_earned', 'updated_at'])

            # Quest progress
            _update_quest_progress(user, 'play_matches', 1)
            if is_winner:
                _update_quest_progress(user, 'win_matches', 1)
            if regions_conquered > 0:
                _update_quest_progress(user, 'conquer_regions', regions_conquered)

        # Check achievements (outside atomic to avoid holding lock)
        check_achievements(str(user.id))

    logger.info('Engagement processed for match %s (%d players).', match_id, len(player_results))


def _update_quest_progress(user, objective_type: str, amount: int):
    """Increment progress on active, non-claimed quests matching objective_type."""
    from django.utils import timezone as dj_tz
    from apps.engagement.models import PlayerQuest

    now = dj_tz.now()
    from django.db.models import Q
    pqs = PlayerQuest.objects.filter(
        user=user,
        quest__objective_type=objective_type,
        is_claimed=False,
        is_completed=False,
    ).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    ).select_related('quest')

    for pq in pqs:
        pq.progress += amount
        if pq.progress >= pq.quest.objective_count:
            pq.progress = pq.quest.objective_count
            pq.is_completed = True
            pq.completed_at = now
        pq.save(update_fields=['progress', 'is_completed', 'completed_at'])


def check_achievements(user_id: str):
    """Check all active achievements for user and unlock newly completed ones.

    This is a helper function (not a Celery task) called from process_match_engagement.
    """
    from apps.engagement.models import Achievement, PlayerAchievement, PlayerProfile
    from apps.inventory.models import Wallet

    try:
        from apps.accounts.models import User
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        logger.error('check_achievements: User %s not found.', user_id)
        return

    try:
        profile = PlayerProfile.objects.get(user=user)
    except PlayerProfile.DoesNotExist:
        return

    already_unlocked = set(
        PlayerAchievement.objects.filter(user=user).values_list('achievement_id', flat=True)
    )

    active_achievements = Achievement.objects.filter(is_active=True).exclude(id__in=already_unlocked)

    for achievement in active_achievements:
        stat_value = _get_stat_for_objective(profile, achievement.objective_type)
        if stat_value >= achievement.objective_count:
            PlayerAchievement.objects.create(user=user, achievement=achievement)
            logger.info(
                'Achievement unlocked for %s: %s',
                user.username,
                achievement.slug,
            )

            # Award XP and gold for unlocking
            if achievement.xp_reward > 0:
                profile.add_xp(achievement.xp_reward)
            if achievement.gold_reward > 0:
                wallet, _ = Wallet.objects.get_or_create(user=user)
                wallet.gold += achievement.gold_reward
                wallet.total_earned += achievement.gold_reward
                wallet.save(update_fields=['gold', 'total_earned', 'updated_at'])


def _get_stat_for_objective(profile, objective_type: str) -> int:
    """Map an objective_type to the corresponding player statistic."""
    mapping = {
        'play_matches': profile.total_matches,
        'win_matches': profile.total_wins,
        'login_streak': profile.best_streak,
    }
    return mapping.get(objective_type, 0)
