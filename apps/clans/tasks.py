import logging
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from math import isclose

from celery import shared_task
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)


def _round_elo_delta(value: float) -> int:
    if isclose(value, 0.0, abs_tol=1e-9):
        return 0
    rounded = int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if rounded == 0:
        return 1 if value > 0 else -1
    return rounded


@shared_task
def expire_clan_invitations():
    """Mark expired pending invitations."""
    from apps.clans.models import ClanInvitation

    expired = ClanInvitation.objects.filter(
        status=ClanInvitation.Status.PENDING,
        expires_at__lt=timezone.now(),
    ).update(status=ClanInvitation.Status.EXPIRED)

    if expired:
        logger.info('Expired %d clan invitations', expired)


@shared_task
def expire_pending_wars(hours: int = 24):
    """Cancel wars pending acceptance for too long."""
    from apps.clans.models import ClanWar

    cutoff = timezone.now() - timedelta(hours=hours)
    cancelled = ClanWar.objects.filter(
        status=ClanWar.Status.PENDING,
        created_at__lt=cutoff,
    ).update(status=ClanWar.Status.CANCELLED)

    if cancelled:
        logger.info('Cancelled %d pending clan wars', cancelled)


@shared_task
def award_clan_xp(user_id: str, xp_amount: int):
    """Award XP to a player's clan after a match."""
    from apps.clans.models import Clan, ClanActivityLog, ClanLevel, ClanMembership

    try:
        membership = ClanMembership.objects.select_related('clan').get(user_id=user_id)
    except ClanMembership.DoesNotExist:
        return

    with transaction.atomic():
        clan = Clan.objects.select_for_update().get(pk=membership.clan_id)
        clan.experience += xp_amount
        clan.save(update_fields=['experience'])

        # Check level up
        next_level = ClanLevel.objects.filter(
            level=clan.level + 1,
            experience_required__lte=clan.experience,
        ).first()

        if next_level:
            clan.level = next_level.level
            clan.max_members = next_level.max_members
            clan.save(update_fields=['level', 'max_members'])

            ClanActivityLog.objects.create(
                clan=clan, actor=None,
                action=ClanActivityLog.Action.CLAN_LEVELED_UP,
                detail={'new_level': next_level.level},
            )
            logger.info('Clan [%s] leveled up to %d', clan.tag, next_level.level)


@shared_task
def calculate_clan_war_elo(war_id: str):
    """Calculate ELO changes for a finished clan war."""
    from apps.clans.models import Clan, ClanActivityLog, ClanWar

    try:
        war = ClanWar.objects.select_related('challenger', 'defender').get(pk=war_id)
    except ClanWar.DoesNotExist:
        logger.error('ClanWar %s not found', war_id)
        return

    if war.status != ClanWar.Status.FINISHED or not war.winner_id:
        return

    k_factor = 32
    challenger = war.challenger
    defender = war.defender

    # Standard ELO calculation
    expected_c = 1.0 / (1.0 + 10 ** ((defender.elo_rating - challenger.elo_rating) / 400.0))
    expected_d = 1.0 - expected_c

    actual_c = 1.0 if war.winner_id == challenger.pk else 0.0
    actual_d = 1.0 - actual_c

    raw_c = k_factor * (actual_c - expected_c)
    raw_d = k_factor * (actual_d - expected_d)

    change_c = _round_elo_delta(raw_c)
    change_d = -change_c  # Zero-sum

    with transaction.atomic():
        war.challenger_elo_change = change_c
        war.defender_elo_change = change_d
        war.save(update_fields=['challenger_elo_change', 'defender_elo_change'])

        Clan.objects.filter(pk=challenger.pk).update(
            elo_rating=challenger.elo_rating + change_c,
        )
        Clan.objects.filter(pk=defender.pk).update(
            elo_rating=defender.elo_rating + change_d,
        )

        # Handle wager transfer
        if war.wager_gold > 0:
            loser = defender if war.winner_id == challenger.pk else challenger
            winner_clan = Clan.objects.select_for_update().get(pk=war.winner_id)
            loser_clan = Clan.objects.select_for_update().get(pk=loser.pk)

            transfer = min(war.wager_gold, loser_clan.treasury_gold)
            if transfer > 0:
                loser_clan.treasury_gold -= transfer
                loser_clan.save(update_fields=['treasury_gold'])
                winner_clan.treasury_gold += transfer
                winner_clan.save(update_fields=['treasury_gold'])

        # Activity logs
        winner_tag = war.challenger.tag if war.winner_id == challenger.pk else war.defender.tag
        loser_tag = war.defender.tag if war.winner_id == challenger.pk else war.challenger.tag

        ClanActivityLog.objects.create(
            clan=war.challenger, actor=None,
            action=(ClanActivityLog.Action.WAR_WON if war.winner_id == challenger.pk
                    else ClanActivityLog.Action.WAR_LOST),
            detail={'against': defender.tag, 'elo_change': change_c},
        )
        ClanActivityLog.objects.create(
            clan=war.defender, actor=None,
            action=(ClanActivityLog.Action.WAR_WON if war.winner_id == defender.pk
                    else ClanActivityLog.Action.WAR_LOST),
            detail={'against': challenger.tag, 'elo_change': change_d},
        )

    logger.info(
        'Clan war %s: [%s] vs [%s] — winner [%s], ELO: %+d / %+d',
        war_id, challenger.tag, defender.tag, winner_tag, change_c, change_d,
    )
