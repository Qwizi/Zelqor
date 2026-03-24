from apps.notifications.models import Notification
from apps.notifications.publisher import publish_social_event


def create_notification(user, type: str, title: str, body: str = "", data: dict = None):
    notif = Notification.objects.create(
        user=user,
        type=type,
        title=title,
        body=body,
        data=data or {},
    )
    # Push real-time via Redis → Rust gateway → WebSocket
    publish_social_event(
        user_id=str(user.pk),
        event_type="notification",
        payload={
            "id": str(notif.pk),
            "type": type,
            "title": title,
            "body": body,
            "data": data or {},
            "is_read": False,
            "created_at": notif.created_at.isoformat(),
        },
    )
    return notif


def notify_friend_request_received(to_user, from_username: str):
    create_notification(
        user=to_user,
        type=Notification.Type.FRIEND_REQUEST_RECEIVED,
        title=f"{from_username} wysłał Ci zaproszenie do znajomych",
        data={"from_username": from_username},
    )


def notify_friend_request_accepted(to_user, accepted_by_username: str):
    create_notification(
        user=to_user,
        type=Notification.Type.FRIEND_REQUEST_ACCEPTED,
        title=f"{accepted_by_username} zaakceptował Twoje zaproszenie",
        data={"username": accepted_by_username},
    )


def notify_match_result(user, placement: int, elo_change: int, match_id: str):
    if placement == 1:
        type_ = Notification.Type.MATCH_WON
        sign = "+" if elo_change >= 0 else ""
        title = f"Wygrałeś mecz! ELO: {sign}{elo_change}"
    else:
        type_ = Notification.Type.MATCH_LOST
        sign = "+" if elo_change >= 0 else ""
        title = f"Przegrałeś mecz. ELO: {sign}{elo_change}"
    create_notification(
        user=user,
        type=type_,
        title=title,
        data={"match_id": match_id, "elo_change": elo_change, "placement": placement},
    )


def notify_player_eliminated(user, match_id: str):
    create_notification(
        user=user,
        type=Notification.Type.PLAYER_ELIMINATED,
        title="Zostałeś wyeliminowany z meczu",
        data={"match_id": match_id},
    )


def notify_game_invite(to_user, from_user, game_mode_slug: str, lobby_id: str = ""):
    create_notification(
        user=to_user,
        type=Notification.Type.GAME_INVITE,
        title=f"{from_user.username} zaprasza Cię do gry!",
        body=f"Tryb: {game_mode_slug}",
        data={
            "from_user_id": str(from_user.pk),
            "from_username": from_user.username,
            "game_mode": game_mode_slug,
            "lobby_id": lobby_id,
        },
    )
