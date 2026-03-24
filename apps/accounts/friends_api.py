import uuid

from django.contrib.auth import get_user_model
from django.db.models import Q
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.accounts.models import Friendship
from apps.accounts.schemas import FriendRequestSchema, FriendshipOutSchema, GameInviteSchema
from apps.pagination import paginate_qs

User = get_user_model()


@api_controller("/friends", tags=["Friends"], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
class FriendsController:
    @route.get("/")
    def list_friends(self, request, limit: int = 50, offset: int = 0):
        """List all accepted friends for the authenticated user."""
        qs = Friendship.objects.select_related("from_user", "to_user").filter(
            Q(from_user=request.auth) | Q(to_user=request.auth),
            status=Friendship.Status.ACCEPTED,
        )
        return paginate_qs(qs, limit, offset, schema=FriendshipOutSchema)

    @route.get("/requests/received/")
    def list_received_requests(self, request, limit: int = 50, offset: int = 0):
        """List pending friend requests received by the authenticated user."""
        qs = Friendship.objects.select_related("from_user", "to_user").filter(
            to_user=request.auth,
            status=Friendship.Status.PENDING,
        )
        return paginate_qs(qs, limit, offset, schema=FriendshipOutSchema)

    @route.get("/requests/sent/")
    def list_sent_requests(self, request, limit: int = 50, offset: int = 0):
        """List pending friend requests sent by the authenticated user."""
        qs = Friendship.objects.select_related("from_user", "to_user").filter(
            from_user=request.auth,
            status=Friendship.Status.PENDING,
        )
        return paginate_qs(qs, limit, offset, schema=FriendshipOutSchema)

    @route.post("/request/", response=FriendshipOutSchema)
    def send_request(self, request, payload: FriendRequestSchema):
        """Send a friend request to another user by username."""
        user = request.auth

        target = User.objects.filter(username=payload.username).first()
        if not target:
            raise HttpError(404, "User not found.")

        if target.pk == user.pk:
            raise HttpError(400, "You cannot send a friend request to yourself.")

        existing = Friendship.objects.filter(
            Q(from_user=user, to_user=target) | Q(from_user=target, to_user=user)
        ).first()
        if existing:
            raise HttpError(400, "A friendship or pending request already exists with this user.")

        friendship = Friendship.objects.create(from_user=user, to_user=target)
        friendship.refresh_from_db()
        from apps.notifications.services import notify_friend_request_received

        notify_friend_request_received(target, user.username)
        # Reload with select_related so nested schemas resolve
        return Friendship.objects.select_related("from_user", "to_user").get(pk=friendship.pk)

    @route.post("/{friendship_id}/accept/", response=FriendshipOutSchema)
    def accept_request(self, request, friendship_id: uuid.UUID):
        """Accept a pending friend request addressed to the authenticated user."""
        friendship = Friendship.objects.select_related("from_user", "to_user").filter(pk=friendship_id).first()
        if not friendship:
            raise HttpError(404, "Friend request not found.")

        if friendship.to_user_id != request.auth.pk:
            raise HttpError(403, "You are not the recipient of this friend request.")

        if friendship.status != Friendship.Status.PENDING:
            raise HttpError(400, "This friend request is not pending.")

        friendship.status = Friendship.Status.ACCEPTED
        friendship.save(update_fields=["status", "updated_at"])
        from apps.notifications.services import notify_friend_request_accepted

        notify_friend_request_accepted(friendship.from_user, request.auth.username)
        return friendship

    @route.post("/{friendship_id}/reject/")
    def reject_request(self, request, friendship_id: uuid.UUID):
        """Reject and delete a pending friend request addressed to the authenticated user."""
        friendship = Friendship.objects.filter(pk=friendship_id).first()
        if not friendship:
            raise HttpError(404, "Friend request not found.")

        if friendship.to_user_id != request.auth.pk:
            raise HttpError(403, "You are not the recipient of this friend request.")

        if friendship.status != Friendship.Status.PENDING:
            raise HttpError(400, "This friend request is not pending.")

        friendship.delete()
        return {"ok": True}

    @route.post("/{friendship_id}/invite-game/")
    def invite_to_game(self, request, friendship_id: uuid.UUID, payload: GameInviteSchema):
        """Create a lobby and invite a friend to join it."""
        from django.db import transaction

        friendship = Friendship.objects.filter(pk=friendship_id).first()
        if not friendship:
            raise HttpError(404, "Friendship not found.")

        user = request.auth
        if friendship.from_user_id != user.pk and friendship.to_user_id != user.pk:
            raise HttpError(403, "You are not part of this friendship.")

        if friendship.status != Friendship.Status.ACCEPTED:
            raise HttpError(400, "You can only invite accepted friends.")

        friend = friendship.to_user if friendship.from_user_id == user.pk else friendship.from_user

        with transaction.atomic():
            # Block duplicate invites — lock + check for unread game_invite to this friend
            from apps.notifications.models import Notification

            existing_invite = (
                Notification.objects.select_for_update()
                .filter(
                    user=friend,
                    type=Notification.Type.GAME_INVITE,
                    is_read=False,
                    data__from_user_id=str(user.pk),
                )
                .first()
            )
            if existing_invite:
                raise HttpError(400, "Zaproszenie już zostało wysłane.")

            # Resolve game mode — fall back to default if slug not found
            from apps.game_config.models import GameMode

            game_mode = GameMode.objects.filter(slug=payload.game_mode, is_active=True).first()
            if not game_mode:
                game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()
            if not game_mode:
                raise HttpError(400, "No active game mode found.")

            # Create lobby with ONLY the inviter — friend joins after accepting
            from apps.matchmaking.models import Lobby, LobbyPlayer

            lobby = Lobby.objects.create(
                host_user=user,
                game_mode=game_mode,
                max_players=game_mode.max_players,
            )
            LobbyPlayer.objects.create(lobby=lobby, user=user)

            lobby_id_str = str(lobby.id)

            from apps.notifications.services import notify_game_invite

            notify_game_invite(friend, user, payload.game_mode, lobby_id=lobby_id_str)

        # Set Redis key for inviter so gateway reconnects them to this lobby
        from django.conf import settings

        import redis as redis_lib

        r = redis_lib.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0)
        r.setex(f"lobby:user:{user.pk}", 600, lobby_id_str)

        return {"lobby_id": lobby_id_str}

    @route.post("/invite-accept/{notification_id}/")
    def accept_game_invite(self, request, notification_id: uuid.UUID):
        """Accept a game invite — join the lobby."""
        from django.utils import timezone

        from apps.matchmaking.models import Lobby, LobbyPlayer
        from apps.notifications.models import Notification

        notif = Notification.objects.filter(pk=notification_id, user=request.auth).first()
        if not notif:
            raise HttpError(404, "Notification not found.")
        if notif.type != Notification.Type.GAME_INVITE:
            raise HttpError(400, "Not a game invite notification.")

        lobby_id = notif.data.get("lobby_id")
        if not lobby_id:
            raise HttpError(400, "Invite has no lobby.")

        lobby = Lobby.objects.filter(pk=lobby_id, status__in=["waiting", "full"]).first()
        if not lobby:
            raise HttpError(400, "Lobby nie istnieje lub już się rozpoczęło.")

        # Add friend to lobby
        LobbyPlayer.objects.get_or_create(lobby=lobby, user=request.auth)

        # Check if lobby is now full
        if lobby.players.count() >= lobby.max_players and lobby.status == "waiting":
            lobby.status = Lobby.Status.FULL
            lobby.full_at = timezone.now()
            lobby.save(update_fields=["status", "full_at"])

        # Set Redis key so gateway reconnects friend to this lobby
        from django.conf import settings

        import redis as redis_lib

        r = redis_lib.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT, db=0)
        r.setex(f"lobby:user:{request.auth.pk}", 600, str(lobby.id))

        # Mark notification as read
        notif.is_read = True
        notif.save(update_fields=["is_read"])

        return {"lobby_id": str(lobby.id), "game_mode": notif.data.get("game_mode", "")}

    @route.post("/invite-reject/{notification_id}/")
    def reject_game_invite(self, request, notification_id: uuid.UUID):
        """Reject a game invite."""
        from apps.notifications.models import Notification

        notif = Notification.objects.filter(pk=notification_id, user=request.auth).first()
        if not notif:
            raise HttpError(404, "Notification not found.")
        if notif.type != Notification.Type.GAME_INVITE:
            raise HttpError(400, "Not a game invite notification.")

        notif.is_read = True
        notif.save(update_fields=["is_read"])

        return {"ok": True}

    @route.delete("/{friendship_id}/")
    def remove_friend(self, request, friendship_id: uuid.UUID):
        """Remove an accepted friend or cancel a sent friend request."""
        friendship = Friendship.objects.filter(pk=friendship_id).first()
        if not friendship:
            raise HttpError(404, "Friendship not found.")

        user_pk = request.auth.pk
        if friendship.from_user_id != user_pk and friendship.to_user_id != user_pk:
            raise HttpError(403, "You are not part of this friendship.")

        friendship.delete()
        return {"ok": True}
