import uuid

from django.contrib.auth import get_user_model
from django.db.models import Q
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.accounts.models import DirectMessage, Friendship
from apps.accounts.schemas import DirectMessageCreateSchema, DirectMessageOutSchema
from apps.pagination import paginate_qs

User = get_user_model()


@api_controller("/messages", tags=["Messages"], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
class MessagesController:
    @route.get("/unread-total/")
    def unread_total(self, request):
        """Get total unread message count across all conversations."""
        count = DirectMessage.objects.filter(receiver=request.auth, is_read=False).count()
        return {"count": count}

    @route.get("/conversations/")
    def list_conversations(self, request):
        """List unique conversation partners with last message."""
        user = request.auth
        sent_to = DirectMessage.objects.filter(sender=user).values_list("receiver_id", flat=True).distinct()
        received_from = DirectMessage.objects.filter(receiver=user).values_list("sender_id", flat=True).distinct()
        partner_ids = set(sent_to) | set(received_from)

        conversations = []
        for partner_id in partner_ids:
            partner = User.objects.filter(pk=partner_id).first()
            if not partner:
                continue
            last_msg = (
                DirectMessage.objects.filter(
                    Q(sender=user, receiver_id=partner_id) | Q(sender_id=partner_id, receiver=user)
                )
                .order_by("-created_at")
                .first()
            )
            unread = DirectMessage.objects.filter(sender_id=partner_id, receiver=user, is_read=False).count()
            conversations.append(
                {
                    "partner": {
                        "id": str(partner.pk),
                        "username": partner.username,
                        "elo_rating": partner.elo_rating,
                        "is_online": partner.is_online,
                        "activity_status": partner.activity_status,
                    },
                    "last_message": {
                        "content": last_msg.content if last_msg else "",
                        "created_at": last_msg.created_at.isoformat() if last_msg else "",
                        "is_mine": last_msg.sender_id == user.pk if last_msg else False,
                    },
                    "unread_count": unread,
                }
            )
        conversations.sort(key=lambda c: c["last_message"]["created_at"], reverse=True)
        return conversations

    @route.get("/{user_id}/")
    def get_messages(self, request, user_id: uuid.UUID, limit: int = 50, offset: int = 0):
        """Get messages between current user and another user."""
        user = request.auth
        friendship = Friendship.objects.filter(
            Q(from_user=user, to_user_id=user_id) | Q(from_user_id=user_id, to_user=user),
            status=Friendship.Status.ACCEPTED,
        ).first()
        if not friendship:
            raise HttpError(403, "You can only message accepted friends.")

        qs = (
            DirectMessage.objects.select_related("sender", "receiver")
            .filter(Q(sender=user, receiver_id=user_id) | Q(sender_id=user_id, receiver=user))
            .order_by("-created_at")
        )

        # Mark received messages as read
        DirectMessage.objects.filter(sender_id=user_id, receiver=user, is_read=False).update(is_read=True)

        return paginate_qs(qs, limit, offset, schema=DirectMessageOutSchema)

    @route.post("/{user_id}/")
    def send_message(self, request, user_id: uuid.UUID, payload: DirectMessageCreateSchema):
        """Send a message to a friend."""
        user = request.auth
        if str(user.pk) == str(user_id):
            raise HttpError(400, "Cannot message yourself.")

        friendship = Friendship.objects.filter(
            Q(from_user=user, to_user_id=user_id) | Q(from_user_id=user_id, to_user=user),
            status=Friendship.Status.ACCEPTED,
        ).first()
        if not friendship:
            raise HttpError(403, "You can only message accepted friends.")

        content = payload.content.strip()
        if not content:
            raise HttpError(400, "Message cannot be empty.")
        if len(content) > 500:
            raise HttpError(400, "Message too long (max 500 characters).")

        msg = DirectMessage.objects.create(sender=user, receiver_id=user_id, content=content)
        msg = DirectMessage.objects.select_related("sender", "receiver").get(pk=msg.pk)

        # Push real-time via Redis → Rust gateway → WebSocket
        from apps.notifications.publisher import publish_social_event

        publish_social_event(
            user_id=str(user_id),
            event_type="direct_message",
            payload={
                "id": str(msg.pk),
                "sender": {
                    "id": str(user.pk),
                    "username": user.username,
                },
                "content": content,
                "created_at": msg.created_at.isoformat(),
            },
        )

        return DirectMessageOutSchema.from_orm(msg).dict()
