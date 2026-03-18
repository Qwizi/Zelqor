import logging

from ninja import Schema
from ninja_extra import ControllerBase, api_controller, route
from pydantic import Field

from apps.internal_auth import check_internal_secret
from apps.game_config.decorators import require_module_controller

logger = logging.getLogger(__name__)


# --- Schemas ---


class SaveMessageRequest(Schema):
    user_id: str
    content: str


class MessageResponse(Schema):
    id: str
    user_id: str
    username: str
    content: str
    timestamp: float


class MessageListResponse(Schema):
    messages: list[MessageResponse]


# --- Controller ---


@api_controller('/internal', tags=['internal'])
@require_module_controller('chat')
class ChatInternalController(ControllerBase):
    """Internal API for the Rust gateway — chat-related endpoints."""

    @route.post('/chat/messages/')
    def save_global_message(self, request, body: SaveMessageRequest):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.accounts.models import User
        from apps.chat.models import ChatMessage

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({'error': 'User not found'}, status_code=404)

        message = ChatMessage.objects.create(user=user, content=body.content)
        return {
            'id': str(message.id),
            'user_id': str(user.id),
            'username': user.username,
            'content': message.content,
            'timestamp': message.created_at.timestamp(),
        }

    @route.get('/chat/messages/')
    def get_global_messages(self, request, limit: int = Field(default=50, le=100)):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.chat.models import ChatMessage

        messages = (
            ChatMessage.objects.select_related('user')
            .order_by('created_at')[: max(1, min(limit, 100))]
        )
        return {
            'messages': [
                {
                    'id': str(m.id),
                    'user_id': str(m.user_id),
                    'username': m.user.username,
                    'content': m.content,
                    'timestamp': m.created_at.timestamp(),
                }
                for m in messages
            ]
        }

    @route.post('/chat/matches/{match_id}/messages/')
    def save_match_message(self, request, match_id: str, body: SaveMessageRequest):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.accounts.models import User
        from apps.chat.models import MatchChatMessage
        from apps.matchmaking.models import Match

        try:
            match = Match.objects.get(id=match_id)
        except Match.DoesNotExist:
            return self.create_response({'error': 'Match not found'}, status_code=404)

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({'error': 'User not found'}, status_code=404)

        message = MatchChatMessage.objects.create(match=match, user=user, content=body.content)
        return {
            'id': str(message.id),
            'user_id': str(user.id),
            'username': user.username,
            'content': message.content,
            'timestamp': message.created_at.timestamp(),
        }

    @route.get('/chat/matches/{match_id}/messages/')
    def get_match_messages(self, request, match_id: str, limit: int = Field(default=50, le=100)):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.chat.models import MatchChatMessage

        messages = (
            MatchChatMessage.objects.filter(match_id=match_id)
            .select_related('user')
            .order_by('created_at')[: max(1, min(limit, 100))]
        )
        return {
            'messages': [
                {
                    'id': str(m.id),
                    'user_id': str(m.user_id),
                    'username': m.user.username,
                    'content': m.content,
                    'timestamp': m.created_at.timestamp(),
                }
                for m in messages
            ]
        }
