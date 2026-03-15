import logging
from celery import shared_task
from django.utils import timezone
from datetime import timedelta

logger = logging.getLogger(__name__)

READY_TIMEOUT_SECONDS = 120  # 2 minutes


@shared_task
def cleanup_stale_lobbies():
    """Periodic cleanup of stale lobbies.

    1. Full lobbies past ready timeout: kick unready non-host players,
       revert to waiting. Publishes events so gateway can notify via WS.
    2. Waiting lobbies older than 10 minutes: cancel.
    3. Empty lobbies (no players): cancel.
    """
    from apps.matchmaking.models import Lobby
    from apps.matchmaking.events import publish_lobby_event
    from django.db.models import Count

    now = timezone.now()
    kicked = 0
    cancelled = 0

    # 1. Full lobbies past ready timeout — kick unready players (not host)
    expired_full = Lobby.objects.filter(
        status=Lobby.Status.FULL,
        full_at__isnull=False,
        full_at__lt=now - timedelta(seconds=READY_TIMEOUT_SECONDS),
    )
    for lobby in expired_full:
        unready = lobby.players.filter(is_ready=False).exclude(user_id=lobby.host_user_id)
        kicked_user_ids = list(unready.values_list('user_id', flat=True))
        kick_count = unready.count()
        unready.delete()

        if kick_count > 0:
            kicked += kick_count
            lobby.status = Lobby.Status.WAITING
            lobby.full_at = None
            lobby.save(update_fields=['status', 'full_at'])
            lobby.players.filter(is_bot=False).update(is_ready=False)
            logger.info(
                f"Lobby {lobby.id}: kicked {kick_count} unready player(s), "
                f"reverted to waiting"
            )
            # Notify gateway via pub/sub
            publish_lobby_event(
                'players_kicked',
                str(lobby.id),
                kicked_user_ids=[str(uid) for uid in kicked_user_ids],
            )

        if lobby.players.count() == 0:
            lobby.status = Lobby.Status.CANCELLED
            lobby.save(update_fields=['status'])
            cancelled += 1
            publish_lobby_event('lobby_cancelled', str(lobby.id), reason='empty')

    # 2. Waiting lobbies older than 10 minutes
    stale_waiting = Lobby.objects.filter(
        status=Lobby.Status.WAITING,
        created_at__lt=now - timedelta(minutes=10),
    )
    for lobby in stale_waiting:
        publish_lobby_event('lobby_cancelled', str(lobby.id), reason='stale')
    cancelled += stale_waiting.update(status=Lobby.Status.CANCELLED)

    # 3. Empty lobbies
    empty_lobbies = (
        Lobby.objects
        .filter(status__in=[Lobby.Status.WAITING, Lobby.Status.FULL, Lobby.Status.READY])
        .annotate(player_count=Count('players'))
        .filter(player_count=0)
    )
    for lobby in empty_lobbies:
        publish_lobby_event('lobby_cancelled', str(lobby.id), reason='empty')
    cancelled += empty_lobbies.update(status=Lobby.Status.CANCELLED)

    if kicked > 0 or cancelled > 0:
        logger.info(f"Lobby cleanup: kicked {kicked} unready players, cancelled {cancelled} lobbies")

    return {'kicked': kicked, 'cancelled': cancelled}
