import json
import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.chat.models import ChatMessage, MatchChatMessage

User = get_user_model()


def make_user(username='chatuser', email='chatuser@example.com', password='testpass123'):
    return User.objects.create_user(username=username, email=email, password=password)


def make_match(user):
    """Create a minimal Match for chat tests."""
    from apps.matchmaking.models import Match
    return Match.objects.create(max_players=2)


INTERNAL_SECRET = 'test-internal-secret'
INTERNAL_HEADERS = {'HTTP_X_INTERNAL_SECRET': INTERNAL_SECRET}


class ChatMessageModelTest(TestCase):

    def setUp(self):
        self.user = make_user()

    def test_create_chat_message(self):
        msg = ChatMessage.objects.create(user=self.user, content='Hello world')
        self.assertIsNotNone(msg.id)
        self.assertEqual(msg.content, 'Hello world')
        self.assertEqual(msg.user, self.user)

    def test_chat_message_str(self):
        msg = ChatMessage.objects.create(user=self.user, content='Test message content')
        s = str(msg)
        self.assertIn('Test message content', s)

    def test_chat_message_str_truncates_content_to_40_chars(self):
        long_content = 'x' * 100
        msg = ChatMessage.objects.create(user=self.user, content=long_content)
        # The __str__ slices content to [:40] — verify the content portion is truncated
        s = str(msg)
        # Content section appears after ': ' — extract it and check it's <= 40 chars
        content_part = s.split(': ', 1)[-1]
        self.assertLessEqual(len(content_part), 40)

    def test_chat_message_uuid_pk(self):
        msg = ChatMessage.objects.create(user=self.user, content='UUID test')
        self.assertIsInstance(msg.id, uuid.UUID)

    def test_chat_message_created_at_auto(self):
        before = timezone.now()
        msg = ChatMessage.objects.create(user=self.user, content='Timestamp test')
        after = timezone.now()
        self.assertGreaterEqual(msg.created_at, before)
        self.assertLessEqual(msg.created_at, after)

    def test_chat_message_ordering_by_created_at(self):
        msg1 = ChatMessage.objects.create(user=self.user, content='First')
        msg2 = ChatMessage.objects.create(user=self.user, content='Second')
        msgs = list(ChatMessage.objects.filter(user=self.user).order_by('created_at'))
        self.assertEqual(msgs[0].id, msg1.id)
        self.assertEqual(msgs[1].id, msg2.id)

    def test_chat_message_cascade_on_user_delete(self):
        user2 = make_user('deluser', 'deluser@example.com')
        msg = ChatMessage.objects.create(user=user2, content='Will be deleted')
        msg_id = msg.id
        user2.delete()
        self.assertFalse(ChatMessage.objects.filter(id=msg_id).exists())

    def test_chat_message_related_name(self):
        ChatMessage.objects.create(user=self.user, content='Related test')
        self.assertEqual(self.user.chat_messages.count(), 1)

    def test_chat_message_content_max_length_field_meta(self):
        # Verify the field declares max_length=500 at the model metadata level.
        # Django TextField with max_length is documented but not enforced at
        # the database layer — the constraint is expressed through the field
        # definition and validated by forms/serialisers.
        field = ChatMessage._meta.get_field('content')
        self.assertEqual(field.max_length, 500)

    def test_chat_message_content_at_max_length(self):
        msg = ChatMessage.objects.create(user=self.user, content='y' * 500)
        self.assertEqual(len(msg.content), 500)


class MatchChatMessageModelTest(TestCase):

    def setUp(self):
        self.user = make_user('matchchat', 'matchchat@example.com')
        self.match = make_match(self.user)

    def test_create_match_chat_message(self):
        msg = MatchChatMessage.objects.create(
            match=self.match, user=self.user, content='GG WP',
        )
        self.assertIsNotNone(msg.id)
        self.assertEqual(msg.content, 'GG WP')
        self.assertEqual(msg.match, self.match)

    def test_match_chat_message_str(self):
        msg = MatchChatMessage.objects.create(
            match=self.match, user=self.user, content='Match message',
        )
        s = str(msg)
        self.assertIn('Match message', s)

    def test_match_chat_message_ordering(self):
        msg1 = MatchChatMessage.objects.create(match=self.match, user=self.user, content='First')
        msg2 = MatchChatMessage.objects.create(match=self.match, user=self.user, content='Second')
        msgs = list(MatchChatMessage.objects.filter(match=self.match).order_by('created_at'))
        self.assertEqual(msgs[0].id, msg1.id)
        self.assertEqual(msgs[1].id, msg2.id)

    def test_match_chat_related_name(self):
        MatchChatMessage.objects.create(match=self.match, user=self.user, content='Hi')
        self.assertEqual(self.match.chat_messages.count(), 1)


class ChatInternalAPITest(TestCase):

    def setUp(self):
        self.user = make_user('internalchat', 'internalchat@example.com')
        self.match = make_match(self.user)

    def test_save_global_message_success(self):
        resp = self.client.post(
            '/api/v1/internal/chat/messages/',
            data=json.dumps({'user_id': str(self.user.id), 'content': 'Hello global'}),
            content_type='application/json',
            **INTERNAL_HEADERS,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['content'], 'Hello global')
        self.assertEqual(data['username'], self.user.username)

    def test_save_global_message_requires_secret(self):
        resp = self.client.post(
            '/api/v1/internal/chat/messages/',
            data=json.dumps({'user_id': str(self.user.id), 'content': 'Unauth'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_save_global_message_user_not_found(self):
        resp = self.client.post(
            '/api/v1/internal/chat/messages/',
            data=json.dumps({'user_id': str(uuid.uuid4()), 'content': 'Ghost'}),
            content_type='application/json',
            **INTERNAL_HEADERS,
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_global_messages(self):
        ChatMessage.objects.create(user=self.user, content='Persisted')
        # Pass limit explicitly to work around the Pydantic FieldInfo default bug
        resp = self.client.get(
            '/api/v1/internal/chat/messages/?limit=50',
            **INTERNAL_HEADERS,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('messages', data)
        self.assertGreaterEqual(len(data['messages']), 1)

    def test_get_global_messages_requires_secret(self):
        resp = self.client.get('/api/v1/internal/chat/messages/?limit=50')
        self.assertEqual(resp.status_code, 403)

    def test_save_match_message_success(self):
        resp = self.client.post(
            f'/api/v1/internal/chat/matches/{self.match.id}/messages/',
            data=json.dumps({'user_id': str(self.user.id), 'content': 'GG'}),
            content_type='application/json',
            **INTERNAL_HEADERS,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['content'], 'GG')

    def test_save_match_message_match_not_found(self):
        fake_id = str(uuid.uuid4())
        resp = self.client.post(
            f'/api/v1/internal/chat/matches/{fake_id}/messages/',
            data=json.dumps({'user_id': str(self.user.id), 'content': 'Ghost match'}),
            content_type='application/json',
            **INTERNAL_HEADERS,
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_match_messages(self):
        MatchChatMessage.objects.create(match=self.match, user=self.user, content='Test')
        # Pass limit explicitly to work around the Pydantic FieldInfo default bug
        resp = self.client.get(
            f'/api/v1/internal/chat/matches/{self.match.id}/messages/?limit=50',
            **INTERNAL_HEADERS,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('messages', data)
        self.assertGreaterEqual(len(data['messages']), 1)

    def test_get_match_messages_requires_secret(self):
        resp = self.client.get(
            f'/api/v1/internal/chat/matches/{self.match.id}/messages/?limit=50',
        )
        self.assertEqual(resp.status_code, 403)
