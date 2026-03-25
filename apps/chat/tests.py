import json
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.chat.models import ChatMessage, MatchChatMessage

User = get_user_model()

INTERNAL_SECRET = "test-internal-secret"
INTERNAL_HEADERS = {"HTTP_X_INTERNAL_SECRET": INTERNAL_SECRET}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def user(db):
    return User.objects.create_user(username="chatuser", email="chatuser@example.com", password="testpass123")


@pytest.fixture
def match(db, user):
    from apps.matchmaking.models import Match

    return Match.objects.create(max_players=2)


# ---------------------------------------------------------------------------
# ChatMessage model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_create_chat_message(user):
    msg = ChatMessage.objects.create(user=user, content="Hello world")
    assert msg.id is not None
    assert msg.content == "Hello world"
    assert msg.user == user


@pytest.mark.django_db
def test_chat_message_str(user):
    msg = ChatMessage.objects.create(user=user, content="Test message content")
    assert "Test message content" in str(msg)


@pytest.mark.django_db
def test_chat_message_str_truncates_content_to_40_chars(user):
    long_content = "x" * 100
    msg = ChatMessage.objects.create(user=user, content=long_content)
    # Content section appears after ': ' — extract it and check it's <= 40 chars
    content_part = str(msg).split(": ", 1)[-1]
    assert len(content_part) <= 40


@pytest.mark.django_db
def test_chat_message_uuid_pk(user):
    msg = ChatMessage.objects.create(user=user, content="UUID test")
    assert isinstance(msg.id, uuid.UUID)


@pytest.mark.django_db
def test_chat_message_created_at_auto(user):
    before = timezone.now()
    msg = ChatMessage.objects.create(user=user, content="Timestamp test")
    after = timezone.now()
    assert msg.created_at >= before
    assert msg.created_at <= after


@pytest.mark.django_db
def test_chat_message_ordering_by_created_at(user):
    msg1 = ChatMessage.objects.create(user=user, content="First")
    msg2 = ChatMessage.objects.create(user=user, content="Second")
    msgs = list(ChatMessage.objects.filter(user=user).order_by("created_at"))
    assert msgs[0].id == msg1.id
    assert msgs[1].id == msg2.id


@pytest.mark.django_db
def test_chat_message_cascade_on_user_delete(db):
    user2 = User.objects.create_user(username="deluser", email="deluser@example.com", password="testpass123")
    msg = ChatMessage.objects.create(user=user2, content="Will be deleted")
    msg_id = msg.id
    user2.delete()
    assert not ChatMessage.objects.filter(id=msg_id).exists()


@pytest.mark.django_db
def test_chat_message_related_name(user):
    ChatMessage.objects.create(user=user, content="Related test")
    assert user.chat_messages.count() == 1


@pytest.mark.django_db
def test_chat_message_content_max_length_field_meta():
    # Verify the field declares max_length=500 at the model metadata level.
    # Django TextField with max_length is documented but not enforced at
    # the database layer — the constraint is expressed through the field
    # definition and validated by forms/serialisers.
    field = ChatMessage._meta.get_field("content")
    assert field.max_length == 500


@pytest.mark.django_db
def test_chat_message_content_at_max_length(user):
    msg = ChatMessage.objects.create(user=user, content="y" * 500)
    assert len(msg.content) == 500


# ---------------------------------------------------------------------------
# MatchChatMessage model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_create_match_chat_message(user, match):
    msg = MatchChatMessage.objects.create(match=match, user=user, content="GG WP")
    assert msg.id is not None
    assert msg.content == "GG WP"
    assert msg.match == match


@pytest.mark.django_db
def test_match_chat_message_str(user, match):
    msg = MatchChatMessage.objects.create(match=match, user=user, content="Match message")
    assert "Match message" in str(msg)


@pytest.mark.django_db
def test_match_chat_message_ordering(user, match):
    msg1 = MatchChatMessage.objects.create(match=match, user=user, content="First")
    msg2 = MatchChatMessage.objects.create(match=match, user=user, content="Second")
    msgs = list(MatchChatMessage.objects.filter(match=match).order_by("created_at"))
    assert msgs[0].id == msg1.id
    assert msgs[1].id == msg2.id


@pytest.mark.django_db
def test_match_chat_related_name(user, match):
    MatchChatMessage.objects.create(match=match, user=user, content="Hi")
    assert match.chat_messages.count() == 1


# ---------------------------------------------------------------------------
# Chat internal API tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_save_global_message_success(client, user):
    resp = client.post(
        "/api/v1/internal/chat/messages/",
        data=json.dumps({"user_id": str(user.id), "content": "Hello global"}),
        content_type="application/json",
        **INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["content"] == "Hello global"
    assert data["username"] == user.username


@pytest.mark.django_db
def test_save_global_message_requires_secret(client, user):
    resp = client.post(
        "/api/v1/internal/chat/messages/",
        data=json.dumps({"user_id": str(user.id), "content": "Unauth"}),
        content_type="application/json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_save_global_message_user_not_found(client):
    resp = client.post(
        "/api/v1/internal/chat/messages/",
        data=json.dumps({"user_id": str(uuid.uuid4()), "content": "Ghost"}),
        content_type="application/json",
        **INTERNAL_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_global_messages(client, user):
    ChatMessage.objects.create(user=user, content="Persisted")
    # Pass limit explicitly to work around the Pydantic FieldInfo default bug
    resp = client.get("/api/v1/internal/chat/messages/?limit=50", **INTERNAL_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "messages" in data
    assert len(data["messages"]) >= 1


@pytest.mark.django_db
def test_get_global_messages_requires_secret(client):
    resp = client.get("/api/v1/internal/chat/messages/?limit=50")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_save_match_message_success(client, user, match):
    resp = client.post(
        f"/api/v1/internal/chat/matches/{match.id}/messages/",
        data=json.dumps({"user_id": str(user.id), "content": "GG"}),
        content_type="application/json",
        **INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["content"] == "GG"


@pytest.mark.django_db
def test_save_match_message_match_not_found(client, user):
    fake_id = str(uuid.uuid4())
    resp = client.post(
        f"/api/v1/internal/chat/matches/{fake_id}/messages/",
        data=json.dumps({"user_id": str(user.id), "content": "Ghost match"}),
        content_type="application/json",
        **INTERNAL_HEADERS,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_match_messages(client, user, match):
    MatchChatMessage.objects.create(match=match, user=user, content="Test")
    # Pass limit explicitly to work around the Pydantic FieldInfo default bug
    resp = client.get(
        f"/api/v1/internal/chat/matches/{match.id}/messages/?limit=50",
        **INTERNAL_HEADERS,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "messages" in data
    assert len(data["messages"]) >= 1


@pytest.mark.django_db
def test_get_match_messages_requires_secret(client, match):
    resp = client.get(f"/api/v1/internal/chat/matches/{match.id}/messages/?limit=50")
    assert resp.status_code == 403
