"""Tests for apps/clans — Clan, Membership, Invitations, Wars."""

import json
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.utils import timezone

from apps.clans.models import (
    Clan,
    ClanActivityLog,
    ClanChatMessage,
    ClanInvitation,
    ClanJoinRequest,
    ClanLevel,
    ClanMembership,
    ClanWar,
    ClanWarParticipant,
)

User = get_user_model()

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def leader():
    return User.objects.create_user(email="leader@test.com", username="leader", password="testpass123")


@pytest.fixture
def member_user():
    return User.objects.create_user(email="member@test.com", username="member", password="testpass123")


@pytest.fixture
def other_user():
    return User.objects.create_user(email="other@test.com", username="other", password="testpass123")


@pytest.fixture
def clan(leader):
    return Clan.objects.create(name="Test Clan", tag="TC", leader=leader)


@pytest.fixture
def membership(clan, leader):
    return ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)


@pytest.fixture
def rival_clan(other_user):
    return Clan.objects.create(name="Rival Clan", tag="RC", leader=other_user)


# ---------------------------------------------------------------------------
# Clan model
# ---------------------------------------------------------------------------


def test_clan_creation(clan):
    assert clan.name == "Test Clan"
    assert clan.tag == "TC"
    assert clan.elo_rating == 1000
    assert clan.level == 1


def test_clan_str(clan):
    assert str(clan) == "[TC] Test Clan"


def test_clan_uuid_pk(clan):
    assert isinstance(clan.id, uuid.UUID)


def test_clan_defaults(clan):
    assert clan.is_recruiting is True
    assert clan.is_public is True
    assert clan.treasury_gold == 0
    assert clan.max_members == 10
    assert clan.experience == 0


def test_clan_name_unique(leader):
    Clan.objects.create(name="Unique", tag="U1", leader=leader)
    with pytest.raises(IntegrityError):
        Clan.objects.create(name="Unique", tag="U2", leader=leader)


def test_clan_tag_unique(leader):
    Clan.objects.create(name="First", tag="DUP", leader=leader)
    with pytest.raises(IntegrityError):
        Clan.objects.create(name="Second", tag="DUP", leader=leader)


def test_clan_member_count(clan, membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    assert clan.member_count == 2


def test_clan_ordering(leader, other_user):
    Clan.objects.create(name="Old Clan", tag="OC", leader=leader)
    c2 = Clan.objects.create(name="New Clan", tag="NC", leader=other_user)
    clans = list(Clan.objects.all())
    assert clans[0] == c2  # newest first


# ---------------------------------------------------------------------------
# ClanMembership
# ---------------------------------------------------------------------------


def test_membership_creation(membership):
    assert membership.role == ClanMembership.Role.LEADER


def test_membership_str(membership):
    s = str(membership)
    assert "TC" in s
    assert "leader" in s


def test_membership_rank(membership):
    assert membership.rank == 4  # Leader = 4


def test_membership_role_hierarchy():
    assert (
        ClanMembership.ROLE_HIERARCHY[ClanMembership.Role.LEADER]
        > ClanMembership.ROLE_HIERARCHY[ClanMembership.Role.OFFICER]
    )
    assert (
        ClanMembership.ROLE_HIERARCHY[ClanMembership.Role.OFFICER]
        > ClanMembership.ROLE_HIERARCHY[ClanMembership.Role.MEMBER]
    )
    assert (
        ClanMembership.ROLE_HIERARCHY[ClanMembership.Role.MEMBER]
        > ClanMembership.ROLE_HIERARCHY[ClanMembership.Role.RECRUIT]
    )


def test_membership_unique_user_per_clan(clan, leader):
    ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    # user already has membership from fixture - OneToOneField on user
    # This should fail
    other_leader = User.objects.create_user(email="l2@test.com", username="l2", password="pass")
    other_clan = Clan.objects.create(name="Other", tag="OT", leader=other_leader)
    with pytest.raises(IntegrityError):
        ClanMembership.objects.create(clan=other_clan, user=leader, role=ClanMembership.Role.MEMBER)


def test_membership_contributions_default(membership):
    assert membership.contributions_gold == 0


# ---------------------------------------------------------------------------
# ClanInvitation
# ---------------------------------------------------------------------------


def test_invitation_creation(clan, leader, member_user):
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=7),
    )
    assert inv.status == ClanInvitation.Status.PENDING


def test_invitation_str(clan, leader, member_user):
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=7),
    )
    s = str(inv)
    assert "TC" in s
    assert "pending" in s


def test_invitation_status_transitions(clan, leader, member_user):
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=7),
    )
    inv.status = ClanInvitation.Status.ACCEPTED
    inv.save()
    inv.refresh_from_db()
    assert inv.status == ClanInvitation.Status.ACCEPTED


# ---------------------------------------------------------------------------
# ClanJoinRequest
# ---------------------------------------------------------------------------


def test_join_request_creation(clan, member_user):
    req = ClanJoinRequest.objects.create(clan=clan, user=member_user, message="Let me in!")
    assert req.status == ClanJoinRequest.Status.PENDING
    assert req.message == "Let me in!"


def test_join_request_str(clan, member_user):
    req = ClanJoinRequest.objects.create(clan=clan, user=member_user)
    s = str(req)
    assert "TC" in s
    assert "pending" in s


def test_join_request_reviewed_by(clan, leader, member_user):
    req = ClanJoinRequest.objects.create(clan=clan, user=member_user)
    req.status = ClanJoinRequest.Status.ACCEPTED
    req.reviewed_by = leader
    req.save()
    req.refresh_from_db()
    assert req.reviewed_by == leader


# ---------------------------------------------------------------------------
# ClanActivityLog
# ---------------------------------------------------------------------------


def test_activity_log_creation(clan, leader):
    log = ClanActivityLog.objects.create(
        clan=clan,
        actor=leader,
        action=ClanActivityLog.Action.MEMBER_JOINED,
        detail={"username": "leader"},
    )
    assert log.action == ClanActivityLog.Action.MEMBER_JOINED
    assert log.detail["username"] == "leader"


def test_activity_log_str(clan, leader):
    log = ClanActivityLog.objects.create(clan=clan, actor=leader, action=ClanActivityLog.Action.GOLD_DONATED)
    s = str(log)
    assert "TC" in s
    assert "gold_donated" in s


def test_activity_log_all_actions_valid(clan, leader):
    for action in ClanActivityLog.Action:
        log = ClanActivityLog.objects.create(clan=clan, actor=leader, action=action)
        assert log.action == action


# ---------------------------------------------------------------------------
# ClanLevel
# ---------------------------------------------------------------------------


def test_clan_level_creation():
    ClanLevel.objects.all().delete()
    lvl = ClanLevel.objects.create(level=1, experience_required=0, max_members=10, treasury_cap=1000)
    assert lvl.level == 1
    assert lvl.max_members == 10


def test_clan_level_str():
    ClanLevel.objects.all().delete()
    lvl = ClanLevel.objects.create(level=5, experience_required=500, max_members=25, treasury_cap=5000)
    assert "5" in str(lvl)
    assert "500" in str(lvl)


def test_clan_level_ordering():
    ClanLevel.objects.all().delete()
    ClanLevel.objects.create(level=3, experience_required=300, max_members=15, treasury_cap=3000)
    ClanLevel.objects.create(level=1, experience_required=0, max_members=10, treasury_cap=1000)
    levels = list(ClanLevel.objects.all())
    assert levels[0].level == 1


def test_clan_level_perks_default():
    ClanLevel.objects.all().delete()
    lvl = ClanLevel.objects.create(level=10, experience_required=0, max_members=10, treasury_cap=1000)
    assert lvl.perks == {}


# ---------------------------------------------------------------------------
# ClanChatMessage
# ---------------------------------------------------------------------------


def test_clan_chat_message(clan, leader):
    msg = ClanChatMessage.objects.create(clan=clan, user=leader, content="Hello clan!")
    assert msg.content == "Hello clan!"


def test_clan_chat_message_str(clan, leader):
    msg = ClanChatMessage.objects.create(clan=clan, user=leader, content="Short msg")
    s = str(msg)
    assert "TC" in s
    assert "Short msg" in s


def test_clan_chat_message_related_name(clan, leader):
    ClanChatMessage.objects.create(clan=clan, user=leader, content="Test")
    assert clan.chat_messages.count() == 1


# ---------------------------------------------------------------------------
# ClanWar
# ---------------------------------------------------------------------------


def test_clan_war_creation(clan, rival_clan):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    assert war.status == ClanWar.Status.PENDING
    assert war.winner is None


def test_clan_war_str(clan, rival_clan):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    s = str(war)
    assert "TC" in s
    assert "RC" in s
    assert "pending" in s


def test_clan_war_defaults(clan, rival_clan):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    assert war.players_per_side == 3
    assert war.wager_gold == 0
    assert war.challenger_elo_change == 0
    assert war.defender_elo_change == 0


def test_clan_war_status_transitions(clan, rival_clan):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    war.status = ClanWar.Status.IN_PROGRESS
    war.started_at = timezone.now()
    war.save()
    war.refresh_from_db()
    assert war.status == ClanWar.Status.IN_PROGRESS


def test_clan_war_set_winner(clan, rival_clan):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.FINISHED)
    war.winner = clan
    war.challenger_elo_change = 25
    war.defender_elo_change = -25
    war.save()
    war.refresh_from_db()
    assert war.winner == clan
    assert war.challenger_elo_change == 25


# ---------------------------------------------------------------------------
# ClanWarParticipant
# ---------------------------------------------------------------------------


def test_war_participant(clan, rival_clan, leader):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    p = ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    assert p.war == war
    assert p.clan == clan


def test_war_participant_str(clan, rival_clan, leader):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    p = ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    s = str(p)
    assert "TC" in s


def test_war_participant_unique_per_war(clan, rival_clan, leader):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    with pytest.raises(IntegrityError):
        ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)


# ===========================================================================
# Helpers
# ===========================================================================


def _get_token(client, user, password="testpass123"):
    """Obtain a JWT access token for the given user (USERNAME_FIELD is email)."""
    resp = client.post(
        "/api/v1/token/pair",
        data=json.dumps({"email": user.email, "password": password}),
        content_type="application/json",
    )
    assert resp.status_code == 200, resp.content
    return resp.json()["access"]


def _auth(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


# ===========================================================================
# Permissions unit tests
# ===========================================================================


def test_get_membership_returns_none_when_no_membership(leader):
    from apps.clans.permissions import get_membership

    assert get_membership(leader) is None


def test_get_membership_returns_membership(clan, leader):
    from apps.clans.permissions import get_membership

    m = ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    result = get_membership(leader)
    assert result == m


def test_get_membership_wrong_clan_returns_none(clan, leader, rival_clan, other_user):
    from apps.clans.permissions import get_membership

    ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    assert get_membership(leader, clan_id=str(rival_clan.pk)) is None


def test_require_membership_raises_403_when_not_member(clan, other_user):
    from ninja.errors import HttpError

    from apps.clans.permissions import require_membership

    with pytest.raises(HttpError) as exc:
        require_membership(other_user, str(clan.pk))
    assert exc.value.status_code == 403


def test_require_leader_raises_403_for_member(clan, member_user):
    from ninja.errors import HttpError

    from apps.clans.permissions import require_leader

    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    with pytest.raises(HttpError) as exc:
        require_leader(member_user, str(clan.pk))
    assert exc.value.status_code == 403


def test_require_officer_passes_for_leader(clan, leader):
    from apps.clans.permissions import require_officer

    ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    m = require_officer(leader, str(clan.pk))
    assert m.role == ClanMembership.Role.LEADER


# ===========================================================================
# API fixture: test client with URL config pointing at test_urls
# ===========================================================================


@pytest.fixture(autouse=True)
def mock_notifications(monkeypatch):
    """Prevent all notification/Redis calls from firing during API tests."""
    monkeypatch.setattr(
        "apps.notifications.services.create_notification",
        lambda **kwargs: None,
    )
    # Also patch publisher used directly in some paths
    monkeypatch.setattr(
        "apps.notifications.publisher.publish_social_event",
        lambda *args, **kwargs: None,
    )


@pytest.fixture
def tc(settings):
    """Django test client using the test URL conf."""
    from django.test import Client

    settings.ROOT_URLCONF = "config.test_urls"
    return Client()


@pytest.fixture
def leader_token(tc, leader):
    return _get_token(tc, leader)


@pytest.fixture
def other_token(tc, other_user):
    return _get_token(tc, other_user)


@pytest.fixture
def member_token(tc, member_user):
    return _get_token(tc, member_user)


@pytest.fixture
def leader_membership(clan, leader):
    return ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)


@pytest.fixture
def other_membership(rival_clan, other_user):
    return ClanMembership.objects.create(clan=rival_clan, user=other_user, role=ClanMembership.Role.LEADER)


# ===========================================================================
# ClanGlobalController — my_clan
# ===========================================================================


def test_my_clan_no_membership(tc, leader, leader_token):
    resp = tc.get("/api/v1/clans/my/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["clan"] is None
    assert data["membership"] is None


def test_my_clan_with_membership(tc, clan, leader, leader_token, leader_membership):
    resp = tc.get("/api/v1/clans/my/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["clan"]["tag"] == "TC"
    assert data["membership"]["role"] == "leader"


def test_my_clan_requires_auth(tc):
    resp = tc.get("/api/v1/clans/my/")
    assert resp.status_code == 401


# ===========================================================================
# ClanGlobalController — leaderboard
# ===========================================================================


def test_leaderboard_empty(tc, leader, leader_token):
    resp = tc.get("/api/v1/clans/leaderboard/", **_auth(leader_token))
    assert resp.status_code == 200
    assert "items" in resp.json()


def test_leaderboard_contains_clan(tc, clan, leader, leader_token):
    resp = tc.get("/api/v1/clans/leaderboard/", **_auth(leader_token))
    assert resp.status_code == 200
    tags = [c["tag"] for c in resp.json()["items"]]
    assert "TC" in tags


def test_leaderboard_sort_by_level(tc, clan, leader, leader_token):
    resp = tc.get("/api/v1/clans/leaderboard/?sort=level", **_auth(leader_token))
    assert resp.status_code == 200


# ===========================================================================
# ClanGlobalController — my_invitations
# ===========================================================================


def test_my_invitations_empty(tc, leader, leader_token):
    resp = tc.get("/api/v1/clans/my-invitations/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_my_invitations_shows_pending(tc, clan, leader, member_user, member_token, leader_membership):
    ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=3),
    )
    resp = tc.get("/api/v1/clans/my-invitations/", **_auth(member_token))
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1


# ===========================================================================
# ClanController — list & get clan
# ===========================================================================


def test_list_clans(tc, clan, leader, leader_token):
    resp = tc.get("/api/v1/clans/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1


def test_list_clans_search(tc, clan, leader, leader_token):
    resp = tc.get("/api/v1/clans/?search=Test", **_auth(leader_token))
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()["items"]]
    assert "Test Clan" in names


def test_list_clans_search_no_match(tc, clan, leader, leader_token):
    resp = tc.get("/api/v1/clans/?search=XYZNOTEXIST", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_get_clan(tc, clan, leader, leader_token):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["tag"] == "TC"
    # Non-member should not see treasury; leader_token is non-member here (no membership)
    assert data["treasury_gold"] == 0


def test_get_clan_member_sees_treasury(tc, clan, leader, leader_token, leader_membership):
    clan.treasury_gold = 500
    clan.save(update_fields=["treasury_gold"])
    resp = tc.get(f"/api/v1/clans/{clan.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["treasury_gold"] == 500


def test_get_clan_not_found(tc, leader, leader_token):
    fake_id = uuid.uuid4()
    resp = tc.get(f"/api/v1/clans/{fake_id}/", **_auth(leader_token))
    assert resp.status_code == 404


# ===========================================================================
# ClanController — create clan
# ===========================================================================


@pytest.fixture
def wallet_for(db):
    """Factory that creates a Wallet with specified gold for a user."""
    from apps.inventory.models import Wallet

    def _make(user, gold=5000):
        return Wallet.objects.create(user=user, gold=gold, total_earned=gold)

    return _make


def test_create_clan_success(tc, leader, leader_token, wallet_for):
    wallet_for(leader, gold=5000)
    payload = {"name": "New Clan", "tag": "NEW", "description": "Desc", "color": "#FF0000", "is_public": True}
    resp = tc.post(
        "/api/v1/clans/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tag"] == "NEW"
    # Wallet should be debited
    from apps.inventory.models import Wallet

    assert Wallet.objects.get(user=leader).gold == 3000


def test_create_clan_insufficient_gold(tc, leader, leader_token, wallet_for):
    wallet_for(leader, gold=100)
    payload = {"name": "Poor Clan", "tag": "PC", "description": "", "color": "#FFFFFF", "is_public": True}
    resp = tc.post(
        "/api/v1/clans/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_create_clan_no_wallet(tc, leader, leader_token):
    payload = {"name": "No Wallet Clan", "tag": "NW", "description": "", "color": "#FFFFFF", "is_public": True}
    resp = tc.post(
        "/api/v1/clans/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_create_clan_already_member(tc, clan, leader, leader_token, leader_membership, wallet_for):
    wallet_for(leader, gold=5000)
    payload = {"name": "Another Clan", "tag": "AC", "description": "", "color": "#FFFFFF", "is_public": True}
    resp = tc.post(
        "/api/v1/clans/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_create_clan_duplicate_tag(tc, leader, other_user, other_token, wallet_for, clan):
    wallet_for(other_user, gold=5000)
    payload = {"name": "Different Name", "tag": "TC", "description": "", "color": "#FFFFFF", "is_public": True}
    resp = tc.post(
        "/api/v1/clans/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(other_token),
    )
    assert resp.status_code == 400


# ===========================================================================
# ClanController — update clan
# ===========================================================================


def test_update_clan_officer(tc, clan, leader, leader_token, leader_membership):
    payload = {"description": "Updated desc"}
    resp = tc.patch(
        f"/api/v1/clans/{clan.pk}/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "Updated desc"


def test_update_clan_non_member_forbidden(tc, clan, other_user, other_token):
    payload = {"description": "Hack"}
    resp = tc.patch(
        f"/api/v1/clans/{clan.pk}/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(other_token),
    )
    assert resp.status_code == 403


def test_update_clan_sets_recruiting(tc, clan, leader, leader_token, leader_membership):
    payload = {"is_recruiting": False}
    resp = tc.patch(
        f"/api/v1/clans/{clan.pk}/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 200
    clan.refresh_from_db()
    assert clan.is_recruiting is False


# ===========================================================================
# ClanController — dissolve clan
# ===========================================================================


def test_dissolve_clan(tc, clan, leader, leader_token, leader_membership):
    resp = tc.delete(f"/api/v1/clans/{clan.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    clan.refresh_from_db()
    assert clan.dissolved_at is not None


def test_dissolve_clan_non_leader_forbidden(tc, clan, member_user, member_token):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.delete(f"/api/v1/clans/{clan.pk}/", **_auth(member_token))
    assert resp.status_code == 403


# ===========================================================================
# ClanController — members
# ===========================================================================


def test_list_members(tc, clan, leader, leader_token, leader_membership):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/members/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert data["items"][0]["role"] == "leader"


def test_list_members_clan_not_found(tc, leader, leader_token):
    resp = tc.get(f"/api/v1/clans/{uuid.uuid4()}/members/", **_auth(leader_token))
    assert resp.status_code == 404


# ===========================================================================
# ClanController — leave clan
# ===========================================================================


def test_leave_clan_member(tc, clan, member_user, member_token, leader_membership):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/leave/", **_auth(member_token))
    assert resp.status_code == 200
    assert not ClanMembership.objects.filter(user=member_user).exists()


def test_leave_clan_leader_forbidden(tc, clan, leader, leader_token, leader_membership):
    resp = tc.post(f"/api/v1/clans/{clan.pk}/leave/", **_auth(leader_token))
    assert resp.status_code == 400


# ===========================================================================
# ClanController — kick member
# ===========================================================================


def test_kick_member(tc, clan, leader, leader_token, leader_membership, member_user, member_token):
    target_m = ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/kick/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert not ClanMembership.objects.filter(pk=target_m.pk).exists()


def test_kick_member_not_in_clan(tc, clan, leader, leader_token, leader_membership, other_user):
    resp = tc.post(f"/api/v1/clans/{clan.pk}/kick/{other_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_kick_member_equal_rank_forbidden(tc, clan, leader, leader_token, leader_membership, other_user):
    # Add another officer — leader cannot kick equal rank since officer < leader
    # but officer trying to kick another officer should fail
    officer_user = User.objects.create_user(email="off@test.com", username="officer_kick", password="testpass123")
    ClanMembership.objects.create(clan=clan, user=officer_user, role=ClanMembership.Role.OFFICER)
    officer_token = _get_token(tc, officer_user)
    # officer tries to kick member — should succeed (officer > member)
    ClanMembership.objects.create(clan=clan, user=other_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/kick/{other_user.pk}/", **_auth(officer_token))
    assert resp.status_code == 200


# ===========================================================================
# ClanController — promote / demote
# ===========================================================================


def test_promote_recruit_to_member(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.RECRUIT)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/promote/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["new_role"] == "member"


def test_promote_member_to_officer(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/promote/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["new_role"] == "officer"


def test_promote_officer_fails(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.OFFICER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/promote/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


def test_demote_officer_to_member(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.OFFICER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/demote/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["new_role"] == "member"


def test_demote_member_to_recruit(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/demote/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["new_role"] == "recruit"


def test_demote_recruit_fails(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.RECRUIT)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/demote/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


# ===========================================================================
# ClanController — transfer leadership
# ===========================================================================


def test_transfer_leadership(tc, clan, leader, leader_token, leader_membership, member_user):
    target_m = ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.OFFICER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/transfer-leadership/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    target_m.refresh_from_db()
    assert target_m.role == ClanMembership.Role.LEADER


def test_transfer_leadership_to_self_fails(tc, clan, leader, leader_token, leader_membership):
    resp = tc.post(f"/api/v1/clans/{clan.pk}/transfer-leadership/{leader.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


# ===========================================================================
# ClanController — invite player
# ===========================================================================


def test_invite_player(tc, clan, leader, leader_token, leader_membership, member_user):
    resp = tc.post(f"/api/v1/clans/{clan.pk}/invite/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert ClanInvitation.objects.filter(clan=clan, invited_user=member_user).exists()


def test_invite_player_already_invited(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=3),
    )
    resp = tc.post(f"/api/v1/clans/{clan.pk}/invite/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


def test_invite_player_already_in_clan(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/invite/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


def test_invite_nonexistent_player(tc, clan, leader, leader_token, leader_membership):
    resp = tc.post(f"/api/v1/clans/{clan.pk}/invite/{uuid.uuid4()}/", **_auth(leader_token))
    assert resp.status_code == 404


# ===========================================================================
# ClanGlobalController — accept / decline invitation
# ===========================================================================


def test_accept_invitation(tc, clan, leader, member_user, member_token, leader_membership):
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=3),
    )
    resp = tc.post(f"/api/v1/clans/invitations/{inv.pk}/accept/", **_auth(member_token))
    assert resp.status_code == 200
    inv.refresh_from_db()
    assert inv.status == ClanInvitation.Status.ACCEPTED
    assert ClanMembership.objects.filter(clan=clan, user=member_user).exists()


def test_accept_invitation_expired(tc, clan, leader, member_user, member_token, leader_membership):
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() - timedelta(hours=1),
    )
    resp = tc.post(f"/api/v1/clans/invitations/{inv.pk}/accept/", **_auth(member_token))
    assert resp.status_code == 400


def test_accept_invitation_already_in_clan(tc, clan, leader, member_user, member_token, leader_membership):
    # member already in clan
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=3),
    )
    resp = tc.post(f"/api/v1/clans/invitations/{inv.pk}/accept/", **_auth(member_token))
    assert resp.status_code == 400


def test_decline_invitation(tc, clan, leader, member_user, member_token, leader_membership):
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=3),
    )
    resp = tc.post(f"/api/v1/clans/invitations/{inv.pk}/decline/", **_auth(member_token))
    assert resp.status_code == 200
    inv.refresh_from_db()
    assert inv.status == ClanInvitation.Status.DECLINED


def test_accept_invitation_not_found(tc, leader, leader_token):
    resp = tc.post(f"/api/v1/clans/invitations/{uuid.uuid4()}/accept/", **_auth(leader_token))
    assert resp.status_code == 404


# ===========================================================================
# ClanController — join (public) / join request (private)
# ===========================================================================


def test_join_public_clan(tc, clan, member_user, member_token, leader_membership):
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/join/",
        data=json.dumps({}),
        content_type="application/json",
        **_auth(member_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["joined"] is True
    assert ClanMembership.objects.filter(clan=clan, user=member_user).exists()


def test_join_public_clan_already_member(tc, clan, member_user, member_token, leader_membership):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/join/",
        data=json.dumps({}),
        content_type="application/json",
        **_auth(member_token),
    )
    assert resp.status_code == 400


def test_join_clan_not_recruiting(tc, clan, member_user, member_token, leader_membership):
    clan.is_recruiting = False
    clan.save(update_fields=["is_recruiting"])
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/join/",
        data=json.dumps({}),
        content_type="application/json",
        **_auth(member_token),
    )
    assert resp.status_code == 400


def test_join_request_private_clan(tc, clan, member_user, member_token, leader_membership):
    clan.is_public = False
    clan.save(update_fields=["is_public"])
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/join/",
        data=json.dumps({"message": "Please accept me"}),
        content_type="application/json",
        **_auth(member_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["joined"] is False
    assert ClanJoinRequest.objects.filter(clan=clan, user=member_user).exists()


def test_join_request_duplicate(tc, clan, member_user, member_token, leader_membership):
    clan.is_public = False
    clan.save(update_fields=["is_public"])
    ClanJoinRequest.objects.create(clan=clan, user=member_user)
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/join/",
        data=json.dumps({}),
        content_type="application/json",
        **_auth(member_token),
    )
    assert resp.status_code == 400


# ===========================================================================
# ClanController — list join requests / accept / decline
# ===========================================================================


def test_list_join_requests_officer(tc, clan, leader, leader_token, leader_membership, member_user):
    ClanJoinRequest.objects.create(clan=clan, user=member_user)
    resp = tc.get(f"/api/v1/clans/{clan.pk}/join-requests/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_list_join_requests_non_member_forbidden(tc, clan, other_user, other_token):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/join-requests/", **_auth(other_token))
    assert resp.status_code == 403


def test_accept_join_request(tc, clan, leader, leader_token, leader_membership, member_user):
    jr = ClanJoinRequest.objects.create(clan=clan, user=member_user)
    resp = tc.post(f"/api/v1/clans/join-requests/{jr.pk}/accept/", **_auth(leader_token))
    assert resp.status_code == 200
    jr.refresh_from_db()
    assert jr.status == ClanJoinRequest.Status.ACCEPTED
    assert ClanMembership.objects.filter(clan=clan, user=member_user).exists()


def test_accept_join_request_not_found(tc, leader, leader_token, leader_membership, clan):
    resp = tc.post(f"/api/v1/clans/join-requests/{uuid.uuid4()}/accept/", **_auth(leader_token))
    assert resp.status_code == 404


def test_decline_join_request(tc, clan, leader, leader_token, leader_membership, member_user):
    jr = ClanJoinRequest.objects.create(clan=clan, user=member_user)
    resp = tc.post(f"/api/v1/clans/join-requests/{jr.pk}/decline/", **_auth(leader_token))
    assert resp.status_code == 200
    jr.refresh_from_db()
    assert jr.status == ClanJoinRequest.Status.DECLINED


# ===========================================================================
# ClanController — treasury
# ===========================================================================


def test_get_treasury(tc, clan, leader, leader_token, leader_membership):
    clan.treasury_gold = 750
    clan.save(update_fields=["treasury_gold"])
    resp = tc.get(f"/api/v1/clans/{clan.pk}/treasury/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["treasury_gold"] == 750


def test_get_treasury_non_member_forbidden(tc, clan, other_user, other_token):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/treasury/", **_auth(other_token))
    assert resp.status_code == 403


def test_donate_gold(tc, clan, leader, leader_token, leader_membership, wallet_for):
    wallet_for(leader, gold=1000)
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/treasury/donate/",
        data=json.dumps({"amount": 300}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 200
    clan.refresh_from_db()
    assert clan.treasury_gold == 300
    leader_membership.refresh_from_db()
    assert leader_membership.contributions_gold == 300


def test_donate_gold_insufficient(tc, clan, leader, leader_token, leader_membership, wallet_for):
    wallet_for(leader, gold=10)
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/treasury/donate/",
        data=json.dumps({"amount": 500}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_donate_gold_no_wallet(tc, clan, leader, leader_token, leader_membership):
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/treasury/donate/",
        data=json.dumps({"amount": 100}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


# ===========================================================================
# ClanController — clan stats
# ===========================================================================


def test_clan_stats(tc, clan, leader, leader_token):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/stats/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["wars_total"] == 0
    assert data["elo_rating"] == 1000


def test_clan_stats_not_found(tc, leader, leader_token):
    resp = tc.get(f"/api/v1/clans/{uuid.uuid4()}/stats/", **_auth(leader_token))
    assert resp.status_code == 404


def test_clan_stats_with_finished_war(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
    )
    resp = tc.get(f"/api/v1/clans/{clan.pk}/stats/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["wars_won"] == 1
    assert data["wars_total"] == 1


# ===========================================================================
# ClanController — activity log
# ===========================================================================


def test_activity_log_member_only(tc, clan, leader, leader_token, leader_membership):
    ClanActivityLog.objects.create(
        clan=clan,
        actor=leader,
        action=ClanActivityLog.Action.MEMBER_JOINED,
        detail={"username": "leader"},
    )
    resp = tc.get(f"/api/v1/clans/{clan.pk}/activity-log/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_activity_log_non_member_forbidden(tc, clan, other_user, other_token):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/activity-log/", **_auth(other_token))
    assert resp.status_code == 403


# ===========================================================================
# ClanController — clan chat
# ===========================================================================


def test_send_chat_message(tc, clan, leader, leader_token, leader_membership):
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/chat/",
        data=json.dumps({"content": "Hello world!"}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == "Hello world!"
    assert ClanChatMessage.objects.filter(clan=clan).count() == 1


def test_send_chat_message_non_member_forbidden(tc, clan, other_user, other_token):
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/chat/",
        data=json.dumps({"content": "Hack"}),
        content_type="application/json",
        **_auth(other_token),
    )
    assert resp.status_code == 403


def test_list_chat_messages(tc, clan, leader, leader_token, leader_membership):
    ClanChatMessage.objects.create(clan=clan, user=leader, content="First")
    ClanChatMessage.objects.create(clan=clan, user=leader, content="Second")
    resp = tc.get(f"/api/v1/clans/{clan.pk}/chat/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 2


def test_list_chat_messages_non_member_forbidden(tc, clan, other_user, other_token):
    resp = tc.get(f"/api/v1/clans/{clan.pk}/chat/", **_auth(other_token))
    assert resp.status_code == 403


# ===========================================================================
# ClanController — declare war
# ===========================================================================


def test_declare_war(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 0}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert ClanWar.objects.filter(challenger=clan, defender=rival_clan).exists()


def test_declare_war_against_self_fails(tc, clan, leader, leader_token, leader_membership):
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 0}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_declare_war_duplicate_active_war(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership
):
    ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.PENDING)
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 0}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_declare_war_with_wager_insufficient_treasury(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership
):
    # clan.treasury_gold defaults to 0
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 500}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_declare_war_with_wager_below_minimum(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership
):
    clan.treasury_gold = 5000
    clan.save(update_fields=["treasury_gold"])
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 50}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_declare_war_non_officer_forbidden(tc, clan, rival_clan, member_user, member_token, other_membership):
    ClanMembership.objects.create(clan=clan, user=member_user, role=ClanMembership.Role.MEMBER)
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 0}),
        content_type="application/json",
        **_auth(member_token),
    )
    assert resp.status_code == 403


# ===========================================================================
# ClanGlobalController — accept / decline war
# ===========================================================================


def test_accept_war(
    tc, clan, rival_clan, leader, leader_token, other_user, other_token, leader_membership, other_membership
):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.PENDING)
    with patch("apps.clans.tasks.start_clan_war.delay"), patch("apps.clans.tasks.start_clan_war.apply_async"):
        resp = tc.post(f"/api/v1/clans/wars/{war.pk}/accept/", **_auth(other_token))
    assert resp.status_code == 200
    war.refresh_from_db()
    assert war.status == ClanWar.Status.ACCEPTED


def test_accept_war_not_found(tc, other_user, other_token):
    resp = tc.post(f"/api/v1/clans/wars/{uuid.uuid4()}/accept/", **_auth(other_token))
    assert resp.status_code == 404


def test_accept_war_insufficient_treasury_for_wager(
    tc, clan, rival_clan, leader, leader_token, other_user, other_token, leader_membership, other_membership
):
    clan.treasury_gold = 1000
    clan.save(update_fields=["treasury_gold"])
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=500,
    )
    # rival_clan treasury defaults to 0 — cannot cover wager
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/accept/", **_auth(other_token))
    assert resp.status_code == 400


def test_decline_war(tc, clan, rival_clan, leader, other_user, other_token, leader_membership, other_membership):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.PENDING)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/decline/", **_auth(other_token))
    assert resp.status_code == 200
    war.refresh_from_db()
    assert war.status == ClanWar.Status.DECLINED


def test_decline_war_refunds_wager(
    tc, clan, rival_clan, leader, other_user, other_token, leader_membership, other_membership
):
    clan.treasury_gold = 0
    clan.save(update_fields=["treasury_gold"])
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=200,
    )
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/decline/", **_auth(other_token))
    assert resp.status_code == 200
    clan.refresh_from_db()
    assert clan.treasury_gold == 200


# ===========================================================================
# ClanGlobalController — cancel war
# ===========================================================================


def test_cancel_war_by_challenger_leader(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership
):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.PENDING)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/cancel/", **_auth(leader_token))
    assert resp.status_code == 200
    war.refresh_from_db()
    assert war.status == ClanWar.Status.CANCELLED


def test_cancel_war_non_member_forbidden(tc, clan, rival_clan, member_user, member_token):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.PENDING)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/cancel/", **_auth(member_token))
    assert resp.status_code == 403


def test_cancel_in_progress_war_fails(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.IN_PROGRESS)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/cancel/", **_auth(leader_token))
    assert resp.status_code == 400


# ===========================================================================
# ClanGlobalController — get war / list participants / leave war / join war
# ===========================================================================


def test_get_war(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan)
    resp = tc.get(f"/api/v1/clans/wars/{war.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


def test_get_war_not_found(tc, leader, leader_token):
    resp = tc.get(f"/api/v1/clans/wars/{uuid.uuid4()}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_list_war_participants(tc, clan, rival_clan, leader, leader_token, leader_membership):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.ACCEPTED)
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    resp = tc.get(f"/api/v1/clans/wars/{war.pk}/participants/", **_auth(leader_token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_leave_war(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.ACCEPTED)
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/leave/", **_auth(leader_token))
    assert resp.status_code == 200
    assert not ClanWarParticipant.objects.filter(war=war, user=leader).exists()


def test_leave_war_not_participant(tc, clan, rival_clan, leader, leader_token, leader_membership):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.ACCEPTED)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/leave/", **_auth(leader_token))
    assert resp.status_code == 404


def test_join_war_not_member_of_either_clan(tc, clan, rival_clan, member_user, member_token):
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.ACCEPTED)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(member_token))
    assert resp.status_code == 403


def test_join_war_success(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=3,
    )
    with patch("apps.clans.tasks.start_clan_war.delay"):
        resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(leader_token))
    assert resp.status_code == 200
    assert ClanWarParticipant.objects.filter(war=war, user=leader).exists()


def test_join_war_already_joined(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=3,
    )
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(leader_token))
    assert resp.status_code == 400


# ===========================================================================
# ClanController — list wars
# ===========================================================================


def test_list_wars(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    ClanWar.objects.create(challenger=clan, defender=rival_clan)
    resp = tc.get(f"/api/v1/clans/{clan.pk}/wars/", **_auth(leader_token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


# ===========================================================================
# Celery tasks
# ===========================================================================


def test_expire_clan_invitations_task(clan, leader, member_user):
    from apps.clans.tasks import expire_clan_invitations

    # Create one expired and one still-valid invitation
    expired_inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() - timedelta(hours=1),
    )
    valid_inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=leader,  # reuse leader as second invitee — different user
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=3),
    )
    expire_clan_invitations()

    expired_inv.refresh_from_db()
    valid_inv.refresh_from_db()
    assert expired_inv.status == ClanInvitation.Status.EXPIRED
    assert valid_inv.status == ClanInvitation.Status.PENDING


def test_expire_pending_wars_task(clan, rival_clan):
    from apps.clans.tasks import expire_pending_wars

    clan.treasury_gold = 0
    clan.save(update_fields=["treasury_gold"])

    old_war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=0,
    )
    # Manually backdate created_at to simulate staleness
    ClanWar.objects.filter(pk=old_war.pk).update(created_at=timezone.now() - timedelta(hours=25))

    expire_pending_wars(hours=24)

    old_war.refresh_from_db()
    assert old_war.status == ClanWar.Status.CANCELLED


def test_expire_pending_wars_refunds_wager(clan, rival_clan):
    from apps.clans.tasks import expire_pending_wars

    clan.treasury_gold = 0
    clan.save(update_fields=["treasury_gold"])

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=300,
    )
    ClanWar.objects.filter(pk=war.pk).update(created_at=timezone.now() - timedelta(hours=25))

    expire_pending_wars(hours=24)

    clan.refresh_from_db()
    assert clan.treasury_gold == 300


def test_award_clan_xp_task_no_membership(leader):
    """Task silently returns when user has no membership."""
    from apps.clans.tasks import award_clan_xp

    award_clan_xp(str(leader.pk), 100)
    # No exception raised and no clan modified


def test_award_clan_xp_task_adds_experience(clan, leader):
    from apps.clans.tasks import award_clan_xp

    ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    award_clan_xp(str(leader.pk), 200)
    clan.refresh_from_db()
    assert clan.experience == 200


def test_award_clan_xp_triggers_level_up(clan, leader):
    from apps.clans.tasks import award_clan_xp

    ClanLevel.objects.all().delete()
    ClanLevel.objects.create(level=1, experience_required=0, max_members=10, treasury_cap=1000)
    ClanLevel.objects.create(level=2, experience_required=100, max_members=20, treasury_cap=2000)

    ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    award_clan_xp(str(leader.pk), 150)
    clan.refresh_from_db()
    assert clan.level == 2
    assert clan.max_members == 20
    assert ClanActivityLog.objects.filter(clan=clan, action=ClanActivityLog.Action.CLAN_LEVELED_UP).exists()


def test_calculate_clan_war_elo_not_found():
    from apps.clans.tasks import calculate_clan_war_elo

    # Should log error but not raise
    calculate_clan_war_elo(str(uuid.uuid4()))


def test_calculate_clan_war_elo_wrong_status(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.IN_PROGRESS)
    calculate_clan_war_elo(str(war.pk))
    # No changes expected
    war.refresh_from_db()
    assert war.challenger_elo_change == 0


def test_calculate_clan_war_elo_updates_ratings(clan, rival_clan, leader, other_user):
    from apps.clans.tasks import calculate_clan_war_elo

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=0,
    )
    calculate_clan_war_elo(str(war.pk))

    clan.refresh_from_db()
    rival_clan.refresh_from_db()
    war.refresh_from_db()

    # Challenger won — should have positive ELO change
    assert war.challenger_elo_change > 0
    assert war.defender_elo_change < 0
    assert clan.elo_rating == 1000 + war.challenger_elo_change
    assert rival_clan.elo_rating == 1000 + war.defender_elo_change


def test_calculate_clan_war_elo_wager_transfer(clan, rival_clan, leader, other_user):
    from apps.clans.tasks import calculate_clan_war_elo

    clan.treasury_gold = 0
    clan.save(update_fields=["treasury_gold"])
    rival_clan.treasury_gold = 0
    rival_clan.save(update_fields=["treasury_gold"])

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=200,
    )
    calculate_clan_war_elo(str(war.pk))

    clan.refresh_from_db()
    # Winner gets both wagers: 200 * 2 = 400
    assert clan.treasury_gold == 400


def test_round_elo_delta_zero():
    from apps.clans.tasks import _round_elo_delta

    assert _round_elo_delta(0.0) == 0


def test_round_elo_delta_positive():
    from apps.clans.tasks import _round_elo_delta

    assert _round_elo_delta(16.5) == 17


def test_round_elo_delta_small_positive():
    from apps.clans.tasks import _round_elo_delta

    # Very small positive value rounds to 1 not 0
    assert _round_elo_delta(0.0001) == 1


def test_round_elo_delta_small_negative():
    from apps.clans.tasks import _round_elo_delta

    assert _round_elo_delta(-0.0001) == -1


# ---------------------------------------------------------------------------
# expire_clan_invitations task — uncovered branches
# ---------------------------------------------------------------------------


def test_expire_clan_invitations_marks_expired(clan, leader, member_user):
    from apps.clans.tasks import expire_clan_invitations

    # Create an invitation that is already past its expiry
    past = timezone.now() - timedelta(hours=1)
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=past,
        status=ClanInvitation.Status.PENDING,
    )
    expire_clan_invitations()
    inv.refresh_from_db()
    assert inv.status == ClanInvitation.Status.EXPIRED


def test_expire_clan_invitations_ignores_future_invitations(clan, leader, member_user):
    from apps.clans.tasks import expire_clan_invitations

    future = timezone.now() + timedelta(days=7)
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=future,
        status=ClanInvitation.Status.PENDING,
    )
    expire_clan_invitations()
    inv.refresh_from_db()
    assert inv.status == ClanInvitation.Status.PENDING


def test_expire_clan_invitations_ignores_already_accepted(clan, leader, member_user):
    from apps.clans.tasks import expire_clan_invitations

    past = timezone.now() - timedelta(hours=1)
    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=past,
        status=ClanInvitation.Status.ACCEPTED,
    )
    expire_clan_invitations()
    inv.refresh_from_db()
    # ACCEPTED should never be changed to EXPIRED
    assert inv.status == ClanInvitation.Status.ACCEPTED


# ---------------------------------------------------------------------------
# expire_pending_wars task — uncovered branches
# ---------------------------------------------------------------------------


def test_expire_pending_wars_cancels_old_pending_war(clan, rival_clan):
    from apps.clans.tasks import expire_pending_wars

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=0,
    )
    # Manually age the war beyond the default 24 h threshold
    ClanWar.objects.filter(pk=war.pk).update(created_at=timezone.now() - timedelta(hours=25))
    expire_pending_wars(hours=24)
    war.refresh_from_db()
    assert war.status == ClanWar.Status.CANCELLED


def test_expire_pending_wars_refunds_wager_to_challenger(clan, rival_clan):
    from apps.clans.tasks import expire_pending_wars

    clan.treasury_gold = 0
    clan.save()
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=500,
    )
    ClanWar.objects.filter(pk=war.pk).update(created_at=timezone.now() - timedelta(hours=25))
    expire_pending_wars(hours=24)
    clan.refresh_from_db()
    assert clan.treasury_gold == 500


def test_expire_pending_wars_ignores_recent_wars(clan, rival_clan):
    from apps.clans.tasks import expire_pending_wars

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=0,
    )
    expire_pending_wars(hours=24)
    war.refresh_from_db()
    assert war.status == ClanWar.Status.PENDING


def test_expire_pending_wars_ignores_non_pending_wars(clan, rival_clan):
    from apps.clans.tasks import expire_pending_wars

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.IN_PROGRESS,
    )
    ClanWar.objects.filter(pk=war.pk).update(created_at=timezone.now() - timedelta(hours=25))
    expire_pending_wars(hours=24)
    war.refresh_from_db()
    assert war.status == ClanWar.Status.IN_PROGRESS


# ---------------------------------------------------------------------------
# award_clan_xp task — uncovered branches
# ---------------------------------------------------------------------------


def test_award_clan_xp_no_membership_does_nothing(leader):
    from apps.clans.tasks import award_clan_xp

    # leader has no membership — task should return silently
    award_clan_xp(str(leader.id), 100)  # no assertion needed — just must not raise


def test_award_clan_xp_adds_experience_to_clan(clan, leader):
    from apps.clans.tasks import award_clan_xp

    ClanMembership.objects.create(clan=clan, user=leader, role=ClanMembership.Role.LEADER)
    clan.experience = 0
    clan.save()

    award_clan_xp(str(leader.id), 200)
    clan.refresh_from_db()
    assert clan.experience == 200


# ---------------------------------------------------------------------------
# calculate_clan_war_elo task — uncovered branches
# ---------------------------------------------------------------------------


def test_calculate_clan_war_elo_nonexistent_war_logs_error(caplog):
    import logging

    from apps.clans.tasks import calculate_clan_war_elo

    with caplog.at_level(logging.ERROR, logger="apps.clans.tasks"):
        calculate_clan_war_elo(str(uuid.uuid4()))
    assert any("not found" in r.message.lower() or "clanwar" in r.message.lower() for r in caplog.records)


def test_calculate_clan_war_elo_skips_non_finished_war(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.IN_PROGRESS,
    )
    before_c = clan.elo_rating
    calculate_clan_war_elo(str(war.pk))
    clan.refresh_from_db()
    assert clan.elo_rating == before_c


def test_calculate_clan_war_elo_zero_sum(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=0,
    )
    elo_sum_before = clan.elo_rating + rival_clan.elo_rating

    with patch("apps.clans.tasks.award_clan_xp.delay"):
        calculate_clan_war_elo(str(war.pk))

    clan.refresh_from_db()
    rival_clan.refresh_from_db()
    assert clan.elo_rating + rival_clan.elo_rating == elo_sum_before


def test_calculate_clan_war_elo_winner_elo_increases(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    before = clan.elo_rating
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=0,
    )
    with patch("apps.clans.tasks.award_clan_xp.delay"):
        calculate_clan_war_elo(str(war.pk))

    clan.refresh_from_db()
    assert clan.elo_rating > before


def test_calculate_clan_war_elo_loser_elo_decreases(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    before = rival_clan.elo_rating
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=0,
    )
    with patch("apps.clans.tasks.award_clan_xp.delay"):
        calculate_clan_war_elo(str(war.pk))

    rival_clan.refresh_from_db()
    assert rival_clan.elo_rating < before


def test_calculate_clan_war_elo_wager_transferred_to_winner(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    clan.treasury_gold = 0
    clan.save()
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=300,
    )
    with patch("apps.clans.tasks.award_clan_xp.delay"):
        calculate_clan_war_elo(str(war.pk))

    clan.refresh_from_db()
    assert clan.treasury_gold == 600  # both wagers: 300 * 2


def test_calculate_clan_war_elo_creates_activity_logs(clan, rival_clan):
    from apps.clans.tasks import calculate_clan_war_elo

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=0,
    )
    with patch("apps.clans.tasks.award_clan_xp.delay"):
        calculate_clan_war_elo(str(war.pk))

    assert ClanActivityLog.objects.filter(clan=clan, action=ClanActivityLog.Action.WAR_WON).exists()
    assert ClanActivityLog.objects.filter(clan=rival_clan, action=ClanActivityLog.Action.WAR_LOST).exists()


# ---------------------------------------------------------------------------
# start_clan_war task — uncovered branches (skipped and error paths)
# ---------------------------------------------------------------------------


def test_start_clan_war_nonexistent_war_logs_error(caplog):
    import logging

    from apps.clans.tasks import start_clan_war

    with caplog.at_level(logging.ERROR, logger="apps.clans.tasks"):
        start_clan_war(str(uuid.uuid4()))
    assert any("not found" in r.message.lower() or "clanwar" in r.message.lower() for r in caplog.records)


def test_start_clan_war_skips_non_accepted_war(clan, rival_clan, caplog):
    import logging

    from apps.clans.tasks import start_clan_war

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
    )
    with caplog.at_level(logging.WARNING, logger="apps.clans.tasks"):
        start_clan_war(str(war.pk))
    # Should log a warning and return without creating a match
    assert any("accepted" in r.message.lower() for r in caplog.records)


def test_start_clan_war_no_game_mode_logs_error(clan, rival_clan, caplog):
    """start_clan_war returns early when GameMode clan-war is not found (line 99-102)."""
    import logging

    from apps.clans.tasks import start_clan_war
    from apps.game_config.models import GameMode

    GameMode.objects.filter(slug="clan-war").delete()
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
    )
    with caplog.at_level(logging.ERROR, logger="apps.clans.tasks"):
        start_clan_war(str(war.pk))
    assert any("clan-war" in r.message.lower() or "gamemode" in r.message.lower() for r in caplog.records)


def test_start_clan_war_no_participants_logs_warning(clan, rival_clan, caplog):
    """start_clan_war returns early when war has no participants (lines 104-107)."""
    import logging

    from apps.clans.tasks import start_clan_war
    from apps.game_config.models import GameMode

    GameMode.objects.get_or_create(slug="clan-war", defaults={"name": "Clan War", "is_active": True})
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
    )
    with caplog.at_level(logging.WARNING, logger="apps.clans.tasks"):
        start_clan_war(str(war.pk))
    assert any("participants" in r.message.lower() for r in caplog.records)


def test_start_clan_war_full_flow(clan, rival_clan, leader, other_user):
    """start_clan_war happy path: creates match, marks war IN_PROGRESS (lines 109-193)."""
    from unittest.mock import MagicMock, patch

    from apps.clans.tasks import start_clan_war
    from apps.game_config.models import GameMode

    GameMode.objects.get_or_create(slug="clan-war", defaults={"name": "Clan War", "is_active": True})

    ClanMembership.objects.get_or_create(clan=clan, user=leader, defaults={"role": ClanMembership.Role.LEADER})
    ClanMembership.objects.get_or_create(
        clan=rival_clan, user=other_user, defaults={"role": ClanMembership.Role.LEADER}
    )

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=1,
    )
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    ClanWarParticipant.objects.create(war=war, clan=rival_clan, user=other_user)

    fake_match_id = str(war.pk)  # reuse war UUID for simplicity
    with (
        patch(
            "apps.clans.tasks._create_match_from_users",
            return_value={"match_id": fake_match_id},
        ),
        patch("apps.matchmaking.models.Match.objects.get") as mock_match_get,
        patch("apps.accounts.push.send_push_to_users"),
        patch("apps.matchmaking.events.publish_lobby_event"),
        patch("apps.clans.tasks.redis_lib") as mock_redis_mod,
    ):
        mock_match = MagicMock()
        mock_match_get.return_value = mock_match

        mock_r = MagicMock()
        mock_redis_mod.Redis.return_value = mock_r

        start_clan_war(str(war.pk))

    war.refresh_from_db()
    assert war.status == ClanWar.Status.IN_PROGRESS


def test_calculate_clan_war_elo_awards_xp_to_participants(clan, rival_clan, leader, other_user):
    """calculate_clan_war_elo iterates participants and calls award_clan_xp.delay (lines 319-320)."""
    from unittest.mock import patch

    from apps.clans.tasks import CLAN_WAR_XP_WIN, calculate_clan_war_elo

    ClanMembership.objects.get_or_create(clan=clan, user=leader, defaults={"role": ClanMembership.Role.LEADER})
    ClanMembership.objects.get_or_create(
        clan=rival_clan, user=other_user, defaults={"role": ClanMembership.Role.LEADER}
    )

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.FINISHED,
        winner=clan,
        wager_gold=0,
    )
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    ClanWarParticipant.objects.create(war=war, clan=rival_clan, user=other_user)

    with patch("apps.clans.tasks.award_clan_xp.delay") as mock_delay:
        calculate_clan_war_elo(str(war.pk))

    # Two participants → two delay calls
    assert mock_delay.call_count == 2
    # Winner participant should get CLAN_WAR_XP_WIN
    calls_args = {args[0]: args[1] for args, _ in mock_delay.call_args_list}
    assert calls_args[str(leader.id)] == CLAN_WAR_XP_WIN


# ---------------------------------------------------------------------------
# clans/api.py — missing branch coverage
# ---------------------------------------------------------------------------


def test_accept_invitation_clan_full(tc, clan, leader, member_user, member_token, leader_membership):
    """accept_invitation returns 400 when clan is full (line 125)."""
    clan.max_members = 1  # already has 1 member (leader)
    clan.save(update_fields=["max_members"])

    inv = ClanInvitation.objects.create(
        clan=clan,
        invited_user=member_user,
        invited_by=leader,
        expires_at=timezone.now() + timedelta(days=1),
    )
    resp = tc.post(f"/api/v1/clans/invitations/{inv.pk}/accept/", **_auth(member_token))
    assert resp.status_code == 400


def test_decline_invitation_not_found(tc, leader, leader_token):
    """decline_invitation with non-existent ID returns 404 (line 152)."""
    resp = tc.post(f"/api/v1/clans/invitations/{uuid.uuid4()}/decline/", **_auth(leader_token))
    assert resp.status_code == 404


def test_accept_join_request_clan_full(tc, clan, leader, member_user, leader_membership):
    """accept_join_request returns 400 when clan is full (line 174)."""
    clan.max_members = 1
    clan.save(update_fields=["max_members"])

    jr = ClanJoinRequest.objects.create(clan=clan, user=member_user)
    leader_token = _get_token(tc, leader)
    resp = tc.post(f"/api/v1/clans/join-requests/{jr.pk}/accept/", **_auth(leader_token))
    assert resp.status_code == 400


def test_accept_join_request_user_already_in_clan(tc, clan, rival_clan, leader, member_user, leader_membership):
    """accept_join_request declines when user is already in another clan (lines 177-179)."""
    # member_user is already a member of rival_clan
    ClanMembership.objects.create(clan=rival_clan, user=member_user, role=ClanMembership.Role.MEMBER)
    jr = ClanJoinRequest.objects.create(clan=clan, user=member_user)
    leader_token = _get_token(tc, leader)
    resp = tc.post(f"/api/v1/clans/join-requests/{jr.pk}/accept/", **_auth(leader_token))
    assert resp.status_code == 400
    jr.refresh_from_db()
    assert jr.status == ClanJoinRequest.Status.DECLINED


def test_decline_join_request_not_found(tc, leader, leader_token, leader_membership):
    """decline_join_request with non-existent ID returns 404 (line 220)."""
    resp = tc.post(f"/api/v1/clans/join-requests/{uuid.uuid4()}/decline/", **_auth(leader_token))
    assert resp.status_code == 404


def test_accept_war_wager_locked_insufficient(
    tc, clan, rival_clan, leader, leader_token, other_user, other_token, leader_membership, other_membership
):
    """accept_war inside atomic block checks treasury again (lines 251-258)."""
    clan.treasury_gold = 5000
    clan.save(update_fields=["treasury_gold"])
    # rival_clan treasury is 0 — cannot cover wager inside atomic
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        wager_gold=500,
    )
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/accept/", **_auth(other_token))
    assert resp.status_code == 400


def test_accept_war_scheduled_future(
    tc, clan, rival_clan, leader, leader_token, other_user, other_token, leader_membership, other_membership
):
    """accept_war with future scheduled_at uses apply_async (line 269)."""
    future = timezone.now() + timedelta(hours=2)
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
        scheduled_at=future,
    )
    with patch("apps.clans.tasks.start_clan_war.apply_async") as mock_async:
        resp = tc.post(f"/api/v1/clans/wars/{war.pk}/accept/", **_auth(other_token))
    assert resp.status_code == 200
    mock_async.assert_called_once()


def test_decline_war_not_found(tc, leader, leader_token):
    """decline_war with non-existent war_id returns 404 (line 277)."""
    resp = tc.post(f"/api/v1/clans/wars/{uuid.uuid4()}/decline/", **_auth(leader_token))
    assert resp.status_code == 404


def test_join_war_not_found(tc, leader, leader_token):
    """join_war with non-existent war_id returns 404 (line 299)."""
    resp = tc.post(f"/api/v1/clans/wars/{uuid.uuid4()}/join/", **_auth(leader_token))
    assert resp.status_code == 404


def test_join_war_not_member_of_either_clan_with_membership_elsewhere(
    tc, clan, rival_clan, leader, leader_membership, other_user, other_token
):
    """join_war returns 403 when user is in a different clan (line 311)."""
    # Create a third clan for other_user
    third_clan = Clan.objects.create(name="Third Clan", tag="T3C", leader=other_user)
    ClanMembership.objects.create(clan=third_clan, user=other_user, role=ClanMembership.Role.LEADER)

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=2,
    )
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(other_token))
    assert resp.status_code == 403


def test_join_war_side_full(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    """join_war returns 400 when the player's side is already full (lines ~310)."""
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=1,
    )
    # Fill challenger side
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    # leader tries to join again — side is full
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(leader_token))
    assert resp.status_code == 400


def test_join_war_both_sides_full_and_not_scheduled_starts_war(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership, other_user, other_token
):
    """Joining the last slot when both sides are full auto-starts war (lines 319-325)."""
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=1,
    )
    # Fill defender side already
    ClanWarParticipant.objects.create(war=war, clan=rival_clan, user=other_user)

    with patch("apps.clans.tasks.start_clan_war.delay") as mock_delay:
        resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(leader_token))

    assert resp.status_code == 200
    mock_delay.assert_called_once_with(str(war.pk))


def test_join_war_both_sides_full_with_future_schedule_does_not_start(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership, other_user, other_token
):
    """Both sides full but scheduled in future → no immediate start (lines 321-322)."""
    future = timezone.now() + timedelta(hours=1)
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        players_per_side=1,
        scheduled_at=future,
    )
    ClanWarParticipant.objects.create(war=war, clan=rival_clan, user=other_user)

    with patch("apps.clans.tasks.start_clan_war.delay") as mock_delay:
        resp = tc.post(f"/api/v1/clans/wars/{war.pk}/join/", **_auth(leader_token))

    assert resp.status_code == 200
    mock_delay.assert_not_called()


def test_leave_war_wrong_status(tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership):
    """leave_war returns 400 when war is not in ACCEPTED status (line 360)."""
    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.PENDING,
    )
    ClanWarParticipant.objects.create(war=war, clan=clan, user=leader)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/leave/", **_auth(leader_token))
    assert resp.status_code == 400


def test_leave_war_not_found_war(tc, leader, leader_token):
    """leave_war with non-existent war_id returns 404 (line 357)."""
    resp = tc.post(f"/api/v1/clans/wars/{uuid.uuid4()}/leave/", **_auth(leader_token))
    assert resp.status_code == 404


def test_cancel_war_not_found(tc, leader, leader_token):
    """cancel_war with non-existent war_id returns 404 (line 377)."""
    resp = tc.post(f"/api/v1/clans/wars/{uuid.uuid4()}/cancel/", **_auth(leader_token))
    assert resp.status_code == 404


def test_cancel_war_non_member_of_either_clan(tc, clan, rival_clan, member_user, leader_membership):
    """cancel_war returns 403 when user is not in either clan (line 390)."""
    member_token = _get_token(tc, member_user)  # no membership
    war = ClanWar.objects.create(challenger=clan, defender=rival_clan, status=ClanWar.Status.PENDING)
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/cancel/", **_auth(member_token))
    assert resp.status_code == 403


def test_cancel_accepted_war_refunds_both_wagers(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership
):
    """Cancelling an ACCEPTED war refunds both challenger and defender wagers (lines 396-406)."""
    clan.treasury_gold = 0
    clan.save(update_fields=["treasury_gold"])
    rival_clan.treasury_gold = 0
    rival_clan.save(update_fields=["treasury_gold"])

    war = ClanWar.objects.create(
        challenger=clan,
        defender=rival_clan,
        status=ClanWar.Status.ACCEPTED,
        wager_gold=200,
    )
    resp = tc.post(f"/api/v1/clans/wars/{war.pk}/cancel/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["refunded_gold"] == 400  # 200 challenger + 200 defender

    clan.refresh_from_db()
    rival_clan.refresh_from_db()
    assert clan.treasury_gold == 200
    assert rival_clan.treasury_gold == 200


def test_update_clan_duplicate_name_returns_400(tc, clan, leader, leader_token, leader_membership, other_user):
    """update_clan returns 400 when new name is taken by another clan (line 518)."""
    Clan.objects.create(name="Taken Name", tag="TKN", leader=other_user)
    payload = {"name": "Taken Name"}
    resp = tc.patch(
        f"/api/v1/clans/{clan.pk}/",
        data=json.dumps(payload),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400


def test_get_clan_non_member_sees_hidden_treasury(tc, clan, leader, leader_token):
    """Non-member gets treasury_gold=0 and tax_percent=0 (line 511)."""
    clan.treasury_gold = 9999
    clan.save(update_fields=["treasury_gold"])
    # No membership fixture — leader_token user has no membership
    resp = tc.get(f"/api/v1/clans/{clan.pk}/", **_auth(leader_token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["treasury_gold"] == 0
    assert data["tax_percent"] == 0
    assert data["my_membership"] is None


def test_dissolve_clan_not_found(tc, leader, leader_token):
    """dissolve_clan returns 404 when clan not found (line 539)."""
    resp = tc.delete(f"/api/v1/clans/{uuid.uuid4()}/", **_auth(leader_token))
    assert resp.status_code in (403, 404)


def test_list_members_clan_not_found_returns_404(tc, leader, leader_token):
    """list_members returns 404 when clan doesn't exist (line 585)."""
    resp = tc.get(f"/api/v1/clans/{uuid.uuid4()}/members/", **_auth(leader_token))
    assert resp.status_code == 404


def test_kick_member_not_in_clan_returns_404(tc, clan, leader, leader_token, leader_membership, other_user):
    """kick_member returns 404 when target is not in clan (line 615)."""
    resp = tc.post(f"/api/v1/clans/{clan.pk}/kick/{other_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_promote_member_already_at_max_returns_400(tc, clan, leader, leader_token, leader_membership, other_user):
    """promote_member returns 400 when target is already officer and actor is leader (line 625)."""
    # Officer cannot be promoted past officer without leader rank — and leader role is max
    # Let's have a leader try to promote another leader (leader cannot be promoted higher)
    another_leader_user = User.objects.create_user(email="promo2@t.com", username="promo2leader", password="x")
    ClanMembership.objects.create(clan=clan, user=another_leader_user, role=ClanMembership.Role.OFFICER)
    # Promote officer to officer is invalid (no mapping from officer to anything)
    # Promote officer → no entry in promotion_map
    # Actually officer is in promotion_map: OFFICER -> none? let's check
    # demotion_map: OFFICER->MEMBER, MEMBER->RECRUIT
    # promotion_map: RECRUIT->MEMBER, MEMBER->OFFICER
    # So to hit line 625, we need target whose role has no promotion (officer already)
    # But wait - line 625 is about ClanMembership.ROLE_HIERARCHY[new_role] >= actor_m.rank
    # Let's have an officer promote a member to officer (same rank as actor) → 403
    officer_user = User.objects.create_user(email="promo_off@t.com", username="promo_officer", password="x")
    ClanMembership.objects.create(clan=clan, user=officer_user, role=ClanMembership.Role.OFFICER)
    officer_token = _get_token(tc, officer_user)

    target_member = User.objects.create_user(email="promo_tgt@t.com", username="promo_target", password="x")
    ClanMembership.objects.create(clan=clan, user=target_member, role=ClanMembership.Role.MEMBER)

    resp = tc.post(f"/api/v1/clans/{clan.pk}/promote/{target_member.pk}/", **_auth(officer_token))
    # officer promoting member to officer → same rank as actor → 403
    assert resp.status_code == 403


def test_promote_member_not_in_clan(tc, clan, leader, leader_token, leader_membership, other_user):
    """promote_member returns 404 when target is not in clan (line 615 area)."""
    resp = tc.post(f"/api/v1/clans/{clan.pk}/promote/{other_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_demote_member_not_in_clan_returns_404(tc, clan, leader, leader_token, leader_membership, other_user):
    """demote_member returns 404 when target is not in clan (line 655)."""
    resp = tc.post(f"/api/v1/clans/{clan.pk}/demote/{other_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_demote_member_already_at_bottom_returns_400(tc, clan, leader, leader_token, leader_membership, other_user):
    """demote_member returns 400 when target is a recruit (no lower role) (line 665 area)."""
    ClanMembership.objects.create(clan=clan, user=other_user, role=ClanMembership.Role.RECRUIT)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/demote/{other_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


def test_demote_member_equal_rank_returns_403(tc, clan, leader, leader_membership, other_user):
    """demote_member returns 403 when target has equal or higher rank (line 665)."""
    officer_user = User.objects.create_user(email="demoter@t.com", username="demoter", password="x")
    ClanMembership.objects.create(clan=clan, user=officer_user, role=ClanMembership.Role.OFFICER)
    demoter_token = _get_token(tc, officer_user)

    # Another officer — equal rank → 403
    ClanMembership.objects.create(clan=clan, user=other_user, role=ClanMembership.Role.OFFICER)
    resp = tc.post(f"/api/v1/clans/{clan.pk}/demote/{other_user.pk}/", **_auth(demoter_token))
    assert resp.status_code == 403


def test_transfer_leadership_target_not_in_clan(tc, clan, leader, leader_token, leader_membership, other_user):
    """transfer_leadership returns 404 when target is not in clan (line 695)."""
    resp = tc.post(f"/api/v1/clans/{clan.pk}/transfer-leadership/{other_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_invite_player_clan_full(tc, clan, leader, leader_token, leader_membership, member_user):
    """invite_player returns 400 when clan is already at max_members (line 724)."""
    clan.max_members = 1
    clan.save(update_fields=["max_members"])
    resp = tc.post(f"/api/v1/clans/{clan.pk}/invite/{member_user.pk}/", **_auth(leader_token))
    assert resp.status_code == 400


def test_invite_player_target_not_found(tc, clan, leader, leader_token, leader_membership):
    """invite_player returns 404 when target user doesn't exist (line 727)."""
    resp = tc.post(f"/api/v1/clans/{clan.pk}/invite/{uuid.uuid4()}/", **_auth(leader_token))
    assert resp.status_code == 404


def test_join_or_request_clan_not_recruiting(tc, clan, leader, leader_token, member_user, member_token):
    """join_or_request returns 400 when clan is not recruiting (line 779)."""
    clan.is_recruiting = False
    clan.save(update_fields=["is_recruiting"])
    resp = tc.post(f"/api/v1/clans/{clan.pk}/join/", **_auth(member_token))
    assert resp.status_code == 400


def test_join_or_request_clan_full(tc, clan, leader, member_user, member_token, leader_membership):
    """join_or_request returns 400 when clan is full (line 783)."""
    clan.max_members = 1
    clan.save(update_fields=["max_members"])
    resp = tc.post(f"/api/v1/clans/{clan.pk}/join/", **_auth(member_token))
    assert resp.status_code == 400


def test_get_treasury_clan_not_found(tc, leader, leader_token, leader_membership):
    """get_treasury returns 404 when clan doesn't exist (line 848)."""
    resp = tc.get(f"/api/v1/clans/{uuid.uuid4()}/treasury/", **_auth(leader_token))
    assert resp.status_code == 404


def test_declare_war_challenger_clan_not_found(tc, clan, rival_clan, leader, leader_token, leader_membership):
    """declare_war returns 404 when challenger clan is dissolved (line 901)."""
    clan.dissolved_at = timezone.now()
    clan.save(update_fields=["dissolved_at"])
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 0}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 404


def test_declare_war_defender_clan_not_found(tc, clan, rival_clan, leader, leader_token, leader_membership):
    """declare_war returns 404 when defender clan is dissolved (line 903)."""
    rival_clan.dissolved_at = timezone.now()
    rival_clan.save(update_fields=["dissolved_at"])
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 2, "wager_gold": 0}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 404


def test_declare_war_wager_treasury_insufficient_inside_atomic(
    tc, clan, rival_clan, leader, leader_token, leader_membership, other_membership
):
    """declare_war fails inside atomic when treasury is insufficient for wager (lines 925-932)."""
    clan.treasury_gold = 200
    clan.save(update_fields=["treasury_gold"])
    resp = tc.post(
        f"/api/v1/clans/{clan.pk}/wars/declare/{rival_clan.pk}/",
        data=json.dumps({"players_per_side": 1, "wager_gold": 500}),
        content_type="application/json",
        **_auth(leader_token),
    )
    assert resp.status_code == 400
