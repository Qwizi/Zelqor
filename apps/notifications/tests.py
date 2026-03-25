"""Tests for apps/notifications — Notification model."""

import json
import uuid
import uuid as _uuid_module

import pytest
from django.contrib.auth import get_user_model

from apps.notifications.models import Notification

User = get_user_model()

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def user():
    return User.objects.create_user(email="notif@test.com", username="notifuser", password="testpass123")


@pytest.fixture
def notification(user):
    return Notification.objects.create(
        user=user,
        type=Notification.Type.MATCH_WON,
        title="You won!",
        body="Congrats on the victory.",
    )


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------


def test_notification_creation(notification):
    assert notification.title == "You won!"
    assert notification.type == Notification.Type.MATCH_WON
    assert notification.is_read is False


def test_notification_str(notification):
    s = str(notification)
    assert "match_won" in s
    assert "notifuser" in s


def test_notification_uuid_pk(notification):
    assert isinstance(notification.id, uuid.UUID)


def test_notification_default_not_read(notification):
    assert notification.is_read is False


def test_notification_mark_read(notification):
    notification.is_read = True
    notification.save()
    notification.refresh_from_db()
    assert notification.is_read is True


def test_notification_body_default_empty(user):
    n = Notification.objects.create(user=user, type=Notification.Type.MATCH_LOST, title="Lost")
    assert n.body == ""


def test_notification_data_default_empty(user):
    n = Notification.objects.create(user=user, type=Notification.Type.GAME_INVITE, title="Invite")
    assert n.data == {}


def test_notification_data_stores_json(user):
    n = Notification.objects.create(
        user=user,
        type=Notification.Type.FRIEND_REQUEST_RECEIVED,
        title="Friend request",
        data={"from_user_id": str(uuid.uuid4())},
    )
    n.refresh_from_db()
    assert "from_user_id" in n.data


def test_notification_ordering_newest_first(user):
    n1 = Notification.objects.create(user=user, type=Notification.Type.MATCH_WON, title="First")
    n2 = Notification.objects.create(user=user, type=Notification.Type.MATCH_LOST, title="Second")
    notifs = list(Notification.objects.filter(user=user))
    assert notifs[0] == n2
    assert notifs[1] == n1


def test_notification_cascade_on_user_delete(user, notification):
    nid = notification.id
    user.delete()
    assert not Notification.objects.filter(id=nid).exists()


def test_notification_related_name(user, notification):
    assert user.notifications.count() == 1


def test_notification_all_types_valid(user):
    for ntype in Notification.Type:
        n = Notification.objects.create(user=user, type=ntype, title=f"Test {ntype}")
        assert n.type == ntype


def test_notification_created_at_auto(notification):
    assert notification.created_at is not None


# ---------------------------------------------------------------------------
# Notification API endpoint tests
# ---------------------------------------------------------------------------


def _get_token(client, email, password):
    resp = client.post(
        "/api/v1/token/pair",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json",
    )
    return resp.json().get("access", "")


def _bearer(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def api_user(db):
    return User.objects.create_user(email="notifapi@test.com", username="notifapiuser", password="testpass123")


def test_list_notifications_requires_auth(client):
    resp = client.get("/api/v1/notifications/")
    assert resp.status_code in (401, 403)


def test_list_notifications_empty(client, api_user):
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.get("/api/v1/notifications/", **_bearer(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0
    assert data["items"] == []


def test_list_notifications_returns_own(client, api_user):
    Notification.objects.create(
        user=api_user,
        type=Notification.Type.MATCH_WON,
        title="Win notification",
    )
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.get("/api/v1/notifications/", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_list_notifications_pagination(client, api_user):
    for i in range(5):
        Notification.objects.create(
            user=api_user,
            type=Notification.Type.MATCH_WON,
            title=f"Notif {i}",
        )
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.get("/api/v1/notifications/?limit=3&offset=0", **_bearer(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 5
    assert len(data["items"]) == 3


def test_unread_count_requires_auth(client):
    resp = client.get("/api/v1/notifications/unread-count")
    assert resp.status_code in (401, 403)


def test_unread_count_zero_when_none(client, api_user):
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.get("/api/v1/notifications/unread-count", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


def test_unread_count_correct(client, api_user):
    Notification.objects.create(user=api_user, type=Notification.Type.MATCH_WON, title="Unread 1", is_read=False)
    Notification.objects.create(user=api_user, type=Notification.Type.MATCH_WON, title="Unread 2", is_read=False)
    Notification.objects.create(user=api_user, type=Notification.Type.MATCH_WON, title="Read", is_read=True)
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.get("/api/v1/notifications/unread-count", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 2


def test_mark_read_requires_auth(client):
    notif_id = _uuid_module.uuid4()
    resp = client.post(f"/api/v1/notifications/{notif_id}/read/")
    assert resp.status_code in (401, 403)


def test_mark_read_marks_notification(client, api_user):
    notif = Notification.objects.create(user=api_user, type=Notification.Type.MATCH_WON, title="Mark me")
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.post(f"/api/v1/notifications/{notif.id}/read/", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    notif.refresh_from_db()
    assert notif.is_read is True


def test_mark_read_unknown_id_still_ok(client, api_user):
    """Updating a non-existent notification is a no-op, not a 404."""
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.post(f"/api/v1/notifications/{_uuid_module.uuid4()}/read/", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_mark_read_does_not_affect_other_users(client, api_user):
    other_user = User.objects.create_user(
        email="other_notif@test.com", username="othernotifuser", password="testpass123"
    )
    notif = Notification.objects.create(user=other_user, type=Notification.Type.MATCH_WON, title="Other's notification")
    token = _get_token(client, "notifapi@test.com", "testpass123")
    client.post(f"/api/v1/notifications/{notif.id}/read/", **_bearer(token))
    notif.refresh_from_db()
    # The notification should remain unread because it belongs to another user
    assert notif.is_read is False


def test_mark_all_read_requires_auth(client):
    resp = client.post("/api/v1/notifications/read-all/")
    assert resp.status_code in (401, 403)


def test_mark_all_read(client, api_user):
    for _ in range(3):
        Notification.objects.create(user=api_user, type=Notification.Type.MATCH_WON, title="Unread")
    token = _get_token(client, "notifapi@test.com", "testpass123")
    resp = client.post("/api/v1/notifications/read-all/", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert Notification.objects.filter(user=api_user, is_read=False).count() == 0


def test_mark_all_read_does_not_affect_other_users(client, api_user):
    other_user = User.objects.create_user(email="other_mark@test.com", username="othermarkuser", password="testpass123")
    notif = Notification.objects.create(user=other_user, type=Notification.Type.MATCH_WON, title="Other's")
    token = _get_token(client, "notifapi@test.com", "testpass123")
    client.post("/api/v1/notifications/read-all/", **_bearer(token))
    notif.refresh_from_db()
    assert notif.is_read is False


# ---------------------------------------------------------------------------
# Notification service function tests
# ---------------------------------------------------------------------------


def test_create_notification_service_persists(api_user):
    from unittest.mock import patch

    from apps.notifications.services import create_notification

    with patch("apps.notifications.services.publish_social_event"):
        notif = create_notification(
            user=api_user,
            type=Notification.Type.MATCH_WON,
            title="Service win",
            body="Body text",
            data={"match_id": "abc"},
        )

    assert notif.pk is not None
    assert notif.title == "Service win"
    assert notif.body == "Body text"
    assert notif.data == {"match_id": "abc"}
    assert notif.is_read is False


def test_create_notification_service_publishes_event(api_user):
    from unittest.mock import patch

    from apps.notifications.services import create_notification

    with patch("apps.notifications.services.publish_social_event") as mock_pub:
        create_notification(
            user=api_user,
            type=Notification.Type.MATCH_WON,
            title="Published",
        )

    mock_pub.assert_called_once()
    call_kwargs = mock_pub.call_args
    assert call_kwargs[1]["event_type"] == "notification" or call_kwargs[0][1] == "notification"


def test_notify_friend_request_received(api_user):
    from unittest.mock import patch

    from apps.notifications.services import notify_friend_request_received

    with patch("apps.notifications.services.publish_social_event"):
        notify_friend_request_received(api_user, from_username="alice")

    notif = Notification.objects.filter(user=api_user, type=Notification.Type.FRIEND_REQUEST_RECEIVED).first()
    assert notif is not None
    assert "alice" in notif.title
    assert notif.data["from_username"] == "alice"


def test_notify_friend_request_accepted(api_user):
    from unittest.mock import patch

    from apps.notifications.services import notify_friend_request_accepted

    with patch("apps.notifications.services.publish_social_event"):
        notify_friend_request_accepted(api_user, accepted_by_username="bob")

    notif = Notification.objects.filter(user=api_user, type=Notification.Type.FRIEND_REQUEST_ACCEPTED).first()
    assert notif is not None
    assert "bob" in notif.title


def test_notify_match_result_win(api_user):
    from unittest.mock import patch

    from apps.notifications.services import notify_match_result

    with patch("apps.notifications.services.publish_social_event"):
        notify_match_result(api_user, placement=1, elo_change=15, match_id="match-123")

    notif = Notification.objects.filter(user=api_user, type=Notification.Type.MATCH_WON).first()
    assert notif is not None
    assert "+15" in notif.title
    assert notif.data["match_id"] == "match-123"
    assert notif.data["placement"] == 1


def test_notify_match_result_loss(api_user):
    from unittest.mock import patch

    from apps.notifications.services import notify_match_result

    with patch("apps.notifications.services.publish_social_event"):
        notify_match_result(api_user, placement=2, elo_change=-10, match_id="match-456")

    notif = Notification.objects.filter(user=api_user, type=Notification.Type.MATCH_LOST).first()
    assert notif is not None
    assert "-10" in notif.title


def test_notify_player_eliminated(api_user):
    from unittest.mock import patch

    from apps.notifications.services import notify_player_eliminated

    with patch("apps.notifications.services.publish_social_event"):
        notify_player_eliminated(api_user, match_id="match-789")

    notif = Notification.objects.filter(user=api_user, type=Notification.Type.PLAYER_ELIMINATED).first()
    assert notif is not None
    assert notif.data["match_id"] == "match-789"


def test_notify_game_invite(api_user):
    from unittest.mock import patch

    from apps.notifications.services import notify_game_invite

    from_user = User.objects.create_user(email="inviter@test.com", username="inviteruser", password="testpass123")
    with patch("apps.notifications.services.publish_social_event"):
        notify_game_invite(
            to_user=api_user,
            from_user=from_user,
            game_mode_slug="ranked",
            lobby_id="lobby-xyz",
        )

    notif = Notification.objects.filter(user=api_user, type=Notification.Type.GAME_INVITE).first()
    assert notif is not None
    assert "inviteruser" in notif.title
    assert notif.data["game_mode"] == "ranked"
    assert notif.data["lobby_id"] == "lobby-xyz"
