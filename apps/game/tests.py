"""
Tests for apps/game — ELO helpers, match finalization, stale cleanup, Redis cleanup.
"""

import json
import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.game.models import GameStateSnapshot, MatchResult, PlayerResult
from apps.game.tasks import (
    _balanced_round_elo_changes,
    _round_elo_delta,
    _safe_ratio,
    cleanup_stale_matches,
    finalize_match_results_sync,
)
from apps.game_config.models import GameSettings
from apps.matchmaking.models import Match, MatchPlayer

User = get_user_model()

INTERNAL_SECRET = "test-internal-secret"
WRONG_SECRET = "wrong-secret"


def _auth():
    return {"X-Internal-Secret": INTERNAL_SECRET}


# ---------------------------------------------------------------------------
# Pure-function ELO helpers — no DB required
# ---------------------------------------------------------------------------


def test_round_elo_delta_positive_rounds_correctly():
    assert _round_elo_delta(4.6) == 5


def test_round_elo_delta_negative_rounds_correctly():
    assert _round_elo_delta(-4.6) == -5


def test_round_elo_delta_exactly_zero_returns_zero():
    assert _round_elo_delta(0.0) == 0


def test_round_elo_delta_very_small_positive_rounds_to_plus_one():
    assert _round_elo_delta(0.000001) == 1


def test_round_elo_delta_very_small_negative_rounds_to_minus_one():
    assert _round_elo_delta(-0.000001) == -1


def test_round_elo_delta_half_rounds_up():
    # ROUND_HALF_UP: 2.5 → 3
    assert _round_elo_delta(2.5) == 3
    assert _round_elo_delta(-2.5) == -3


def test_round_elo_delta_integer_values_unchanged():
    assert _round_elo_delta(10.0) == 10
    assert _round_elo_delta(-7.0) == -7


def test_balanced_round_elo_changes_zero_sum_two_players():
    raw = [15.3, -15.3]
    assert sum(_balanced_round_elo_changes(raw)) == 0


def test_balanced_round_elo_changes_zero_sum_four_players():
    raw = [12.1, 5.7, -8.4, -9.4]
    assert sum(_balanced_round_elo_changes(raw)) == 0


def test_balanced_round_elo_changes_winner_gains_loser_loses():
    raw = [20.0, -20.0]
    result = _balanced_round_elo_changes(raw)
    assert len(result) == 2
    assert result[0] > 0
    assert result[1] < 0


def test_balanced_round_elo_changes_returns_integers():
    raw = [8.75, -8.75]
    result = _balanced_round_elo_changes(raw)
    for val in result:
        assert isinstance(val, int)


def test_balanced_round_elo_changes_all_zeros():
    raw = [0.0, 0.0, 0.0]
    result = _balanced_round_elo_changes(raw)
    assert result == [0, 0, 0]
    assert sum(result) == 0


def test_balanced_round_elo_changes_single_player_zero():
    raw = [0.0]
    assert _balanced_round_elo_changes(raw) == [0]


def test_balanced_round_elo_changes_large_k_factor_zero_sum():
    raw = [64.1, -32.0, -32.1]
    assert sum(_balanced_round_elo_changes(raw)) == 0


def test_balanced_round_elo_changes_equal_elo_balanced_game():
    raw = [0.5, -0.5]
    assert sum(_balanced_round_elo_changes(raw)) == 0


def test_balanced_round_elo_changes_very_different_elo_zero_sum():
    raw = [1.6, -1.6]
    assert sum(_balanced_round_elo_changes(raw)) == 0


def test_balanced_round_elo_changes_k_factor_scaling():
    """K=64 raw changes should round to larger integers than K=16."""
    raw_large = [32.0, -32.0]
    raw_small = [8.0, -8.0]
    result_large = _balanced_round_elo_changes(raw_large)
    result_small = _balanced_round_elo_changes(raw_small)
    assert result_large[0] > result_small[0]


def test_safe_ratio_normal():
    assert _safe_ratio(3, 10) == pytest.approx(0.3)


def test_safe_ratio_zero_denominator_returns_zero():
    assert _safe_ratio(5, 0) == 0.0


def test_safe_ratio_full():
    assert _safe_ratio(10, 10) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# finalize_match_results_sync — DB tests
# ---------------------------------------------------------------------------


@pytest.fixture
def two_player_match(db):
    GameSettings.get()
    user1 = User.objects.create_user(
        email="player1@test.com",
        username="player1",
        password="testpass123",
        elo_rating=1000,
    )
    user2 = User.objects.create_user(
        email="player2@test.com",
        username="player2",
        password="testpass123",
        elo_rating=1000,
    )
    match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(minutes=10),
    )
    MatchPlayer.objects.create(match=match, user=user1, color="#FF0000")
    MatchPlayer.objects.create(match=match, user=user2, color="#0000FF")
    return match, user1, user2


def _make_final_state(user1_id, user2_id):
    return {
        "players": {
            str(user1_id): {
                "is_alive": True,
                "total_regions_conquered": 10,
                "total_units_produced": 50,
                "total_units_lost": 5,
                "total_buildings_built": 3,
                "eliminated_reason": "",
                "eliminated_tick": 0,
            },
            str(user2_id): {
                "is_alive": False,
                "total_regions_conquered": 5,
                "total_units_produced": 25,
                "total_units_lost": 20,
                "total_buildings_built": 1,
                "eliminated_reason": "",
                "eliminated_tick": 100,
            },
        },
        "regions": {},
    }


def _finalize(match, winner, final_state=None, total_ticks=200):
    if final_state is None:
        final_state = _make_final_state(winner.id, match.matchplayer_set.exclude(user=winner).first().user_id)
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        finalize_match_results_sync(str(match.id), str(winner.id), total_ticks, final_state)


@pytest.mark.django_db
def test_finalize_creates_match_result(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    assert MatchResult.objects.filter(match=match).exists()


@pytest.mark.django_db
def test_finalize_creates_player_results_for_all_players(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    result = MatchResult.objects.get(match=match)
    assert result.player_results.count() == 2


@pytest.mark.django_db
def test_finalize_winner_has_placement_one(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    result = MatchResult.objects.get(match=match)
    winner_pr = result.player_results.get(user=user1)
    assert winner_pr.placement == 1


@pytest.mark.django_db
def test_finalize_loser_has_higher_placement(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    result = MatchResult.objects.get(match=match)
    loser_pr = result.player_results.get(user=user2)
    assert loser_pr.placement > 1


@pytest.mark.django_db
def test_finalize_match_status_set_to_finished(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    match.refresh_from_db()
    assert match.status == Match.Status.FINISHED


@pytest.mark.django_db
def test_finalize_match_finished_at_is_set(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    match.refresh_from_db()
    assert match.finished_at is not None


@pytest.mark.django_db
def test_finalize_snapshot_saved_at_correct_tick(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    assert GameStateSnapshot.objects.filter(match=match, tick=200).exists()


@pytest.mark.django_db
def test_finalize_idempotent_does_not_duplicate_match_result(two_player_match):
    match, user1, user2 = two_player_match
    final_state = _make_final_state(user1.id, user2.id)
    _finalize(match, user1, final_state)
    _finalize(match, user1, final_state)
    assert MatchResult.objects.filter(match=match).count() == 1


@pytest.mark.django_db
def test_finalize_elo_zero_sum_two_players(two_player_match):
    match, user1, user2 = two_player_match
    elo_before = user1.elo_rating + user2.elo_rating
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    user1.refresh_from_db()
    user2.refresh_from_db()
    assert user1.elo_rating + user2.elo_rating == elo_before


@pytest.mark.django_db
def test_finalize_winner_elo_increases(two_player_match):
    match, user1, user2 = two_player_match
    elo_before = user1.elo_rating
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    user1.refresh_from_db()
    assert user1.elo_rating > elo_before


@pytest.mark.django_db
def test_finalize_loser_elo_decreases(two_player_match):
    match, user1, user2 = two_player_match
    elo_before = user2.elo_rating
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    user2.refresh_from_db()
    assert user2.elo_rating < elo_before


@pytest.mark.django_db
def test_finalize_bot_player_elo_unchanged(db):
    GameSettings.get()
    user1 = User.objects.create_user(email="human@test.com", username="human", password="testpass123", elo_rating=1000)
    bot = User.objects.create_user(
        email="bot@test.com", username="testbot", password="testpass123", elo_rating=1000, is_bot=True
    )
    match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(minutes=10),
    )
    MatchPlayer.objects.create(match=match, user=user1, color="#FF0000")
    MatchPlayer.objects.create(match=match, user=bot, color="#00FF00")

    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        finalize_match_results_sync(
            str(match.id),
            str(user1.id),
            200,
            {
                "players": {
                    str(user1.id): {
                        "is_alive": True,
                        "total_regions_conquered": 10,
                        "total_units_produced": 50,
                        "total_units_lost": 5,
                        "total_buildings_built": 3,
                        "eliminated_reason": "",
                        "eliminated_tick": 0,
                    },
                    str(bot.id): {
                        "is_alive": False,
                        "total_regions_conquered": 3,
                        "total_units_produced": 20,
                        "total_units_lost": 15,
                        "total_buildings_built": 1,
                        "eliminated_reason": "",
                        "eliminated_tick": 50,
                    },
                },
                "regions": {},
            },
        )
    bot.refresh_from_db()
    assert bot.elo_rating == 1000


@pytest.mark.django_db
def test_finalize_uses_settings_snapshot_k_factor(two_player_match):
    match, user1, user2 = two_player_match
    match.settings_snapshot = {"elo_k_factor": 64}
    match.save()
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    assert MatchResult.objects.filter(match=match).exists()


@pytest.mark.django_db
def test_finalize_total_ticks_stored(two_player_match):
    match, user1, user2 = two_player_match
    _finalize(match, user1, _make_final_state(user1.id, user2.id))
    result = MatchResult.objects.get(match=match)
    assert result.total_ticks == 200


# ---------------------------------------------------------------------------
# cleanup_stale_matches
# ---------------------------------------------------------------------------


@pytest.fixture
def cleanup_user(db):
    GameSettings.get()
    return User.objects.create_user(
        email="cleanup@test.com",
        username="cleanupuser",
        password="testpass123",
    )


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_cancels_old_selecting_match(mock_cleanup, cleanup_user):
    old_match = Match.objects.create(status=Match.Status.SELECTING, max_players=2)
    Match.objects.filter(pk=old_match.pk).update(created_at=timezone.now() - timedelta(minutes=10))
    cleanup_stale_matches()
    old_match.refresh_from_db()
    assert old_match.status == Match.Status.CANCELLED


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_cancels_old_in_progress_match(mock_cleanup, cleanup_user):
    old_match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(hours=3),
    )
    cleanup_stale_matches()
    old_match.refresh_from_db()
    assert old_match.status == Match.Status.CANCELLED


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_does_not_cancel_recent_selecting_match(mock_cleanup, cleanup_user):
    recent_match = Match.objects.create(status=Match.Status.SELECTING, max_players=2)
    cleanup_stale_matches()
    recent_match.refresh_from_db()
    assert recent_match.status == Match.Status.SELECTING


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_does_not_cancel_recent_in_progress_match(mock_cleanup, cleanup_user):
    recent_match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(minutes=30),
    )
    cleanup_stale_matches()
    recent_match.refresh_from_db()
    assert recent_match.status == Match.Status.IN_PROGRESS


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_does_not_cancel_finished_matches(mock_cleanup, cleanup_user):
    finished_match = Match.objects.create(
        status=Match.Status.FINISHED,
        max_players=2,
        started_at=timezone.now() - timedelta(hours=5),
        finished_at=timezone.now() - timedelta(hours=4),
    )
    cleanup_stale_matches()
    finished_match.refresh_from_db()
    assert finished_match.status == Match.Status.FINISHED


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_sets_players_alive_false(mock_cleanup, cleanup_user):
    old_match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(hours=3),
    )
    mp = MatchPlayer.objects.create(match=old_match, user=cleanup_user, is_alive=True)
    cleanup_stale_matches()
    mp.refresh_from_db()
    assert mp.is_alive is False


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_redis_called_for_stale_match(mock_cleanup, cleanup_user):
    old_match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(hours=3),
    )
    cleanup_stale_matches()
    mock_cleanup.delay.assert_called_once_with(str(old_match.id))


# ---------------------------------------------------------------------------
# cleanup_redis_game_state
# ---------------------------------------------------------------------------


@patch("apps.game.tasks.redis.Redis")
def test_redis_cleanup_deletes_known_suffixes(mock_redis_cls):
    from apps.game.tasks import cleanup_redis_game_state

    mock_r = MagicMock()
    mock_r.delete.return_value = 5
    mock_redis_cls.return_value = mock_r

    match_id = str(uuid.uuid4())
    cleanup_redis_game_state(match_id)

    mock_r.delete.assert_called_once()
    deleted_keys = mock_r.delete.call_args[0]
    assert f"game:{match_id}:meta" in deleted_keys
    assert f"game:{match_id}:players" in deleted_keys
    assert f"game:{match_id}:regions" in deleted_keys
    assert f"game:{match_id}:actions" in deleted_keys
    mock_r.close.assert_called_once()


@patch("apps.game.tasks.redis.Redis")
def test_redis_cleanup_runs_without_error_when_nothing_deleted(mock_redis_cls):
    from apps.game.tasks import cleanup_redis_game_state

    mock_r = MagicMock()
    mock_r.delete.return_value = 0
    mock_redis_cls.return_value = mock_r

    cleanup_redis_game_state(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# Model string representations
# ---------------------------------------------------------------------------


@pytest.fixture
def model_str_fixtures(db):
    GameSettings.get()
    user = User.objects.create_user(
        email="strtest@test.com",
        username="strtest",
        password="testpass123",
    )
    match = Match.objects.create(status=Match.Status.FINISHED, max_players=2)
    return user, match


@pytest.mark.django_db
def test_snapshot_str(model_str_fixtures):
    _, match = model_str_fixtures
    snap = GameStateSnapshot.objects.create(match=match, tick=42, state_data={"foo": "bar"})
    assert "42" in str(snap)


@pytest.mark.django_db
def test_match_result_str(model_str_fixtures):
    _, match = model_str_fixtures
    result = MatchResult.objects.create(match=match, total_ticks=100)
    assert "Result" in str(result)


@pytest.mark.django_db
def test_player_result_str(model_str_fixtures):
    user, match = model_str_fixtures
    result = MatchResult.objects.create(match=match, total_ticks=100)
    pr = PlayerResult.objects.create(match_result=result, user=user, placement=1)
    assert "strtest" in str(pr)
    assert "#1" in str(pr)


# ---------------------------------------------------------------------------
# Internal API — shared fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def internal_api(db, client):
    """Returns (client, match, user1, user2)."""
    GameSettings.get()
    user1 = User.objects.create_user(
        email="gapi1@test.com",
        username="gapi_player1",
        password="testpass123",
        elo_rating=1000,
    )
    user2 = User.objects.create_user(
        email="gapi2@test.com",
        username="gapi_player2",
        password="testpass123",
        elo_rating=1000,
    )
    match = Match.objects.create(
        status=Match.Status.IN_PROGRESS,
        max_players=2,
        started_at=timezone.now() - timedelta(minutes=5),
    )
    MatchPlayer.objects.create(match=match, user=user1, color="#FF0000")
    MatchPlayer.objects.create(match=match, user=user2, color="#0000FF")
    return client, match, user1, user2


def _api_final_state(user1_id, user2_id):
    return {
        "players": {
            str(user1_id): {
                "is_alive": True,
                "total_regions_conquered": 10,
                "total_units_produced": 50,
                "total_units_lost": 5,
                "total_buildings_built": 3,
                "eliminated_reason": "",
                "eliminated_tick": 0,
            },
            str(user2_id): {
                "is_alive": False,
                "total_regions_conquered": 4,
                "total_units_produced": 20,
                "total_units_lost": 15,
                "total_buildings_built": 1,
                "eliminated_reason": "",
                "eliminated_tick": 80,
            },
        },
        "regions": {},
    }


# --- Auth guards ---


@pytest.mark.django_db
def test_snapshot_missing_secret_returns_403(internal_api):
    client, match, user1, _ = internal_api
    resp = client.post(
        "/api/v1/internal/game/snapshot/",
        data=json.dumps({"match_id": str(match.id), "tick": 1, "state_data": {}}),
        content_type="application/json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_snapshot_wrong_secret_returns_403(internal_api):
    client, match, _, _ = internal_api
    resp = client.post(
        "/api/v1/internal/game/snapshot/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps({"match_id": str(match.id), "tick": 1, "state_data": {}}),
        content_type="application/json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_finalize_wrong_secret_returns_403(internal_api):
    client, match, user1, _ = internal_api
    resp = client.post(
        "/api/v1/internal/game/finalize/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps(
            {
                "match_id": str(match.id),
                "winner_id": str(user1.id),
                "total_ticks": 100,
                "final_state": {},
            }
        ),
        content_type="application/json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_cleanup_wrong_secret_returns_403(internal_api):
    client, match, _, _ = internal_api
    resp = client.post(
        "/api/v1/internal/game/cleanup/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps({"match_id": str(match.id)}),
        content_type="application/json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_get_user_wrong_secret_returns_403(internal_api):
    client, _, user1, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/users/{user1.id}/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_verify_player_wrong_secret_returns_403(internal_api):
    client, match, user1, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-player/{user1.id}/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_match_data_wrong_secret_returns_403(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/data/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_anticheat_report_wrong_secret_returns_403(internal_api):
    client, match, user1, _ = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/report-violation/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps(
            {
                "match_id": str(match.id),
                "player_id": str(user1.id),
                "violation_kind": "action_flood",
                "severity": "warn",
                "detail": "Too many actions",
                "tick": 5,
            }
        ),
        content_type="application/json",
    )
    assert resp.status_code == 403


# --- Save snapshot ---


@pytest.mark.django_db
def test_save_snapshot_success(internal_api):
    client, match, _, _ = internal_api
    resp = client.post(
        "/api/v1/internal/game/snapshot/",
        headers=_auth(),
        data=json.dumps(
            {
                "match_id": str(match.id),
                "tick": 10,
                "state_data": {"regions": {}, "players": {}},
            }
        ),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.django_db
def test_save_snapshot_persists_to_db(internal_api):
    client, match, _, _ = internal_api
    client.post(
        "/api/v1/internal/game/snapshot/",
        headers=_auth(),
        data=json.dumps({"match_id": str(match.id), "tick": 20, "state_data": {"tick": 20}}),
        content_type="application/json",
    )
    assert GameStateSnapshot.objects.filter(match=match, tick=20).exists()


@pytest.mark.django_db
def test_save_snapshot_upserts_on_same_tick(internal_api):
    client, match, _, _ = internal_api
    client.post(
        "/api/v1/internal/game/snapshot/",
        headers=_auth(),
        data=json.dumps({"match_id": str(match.id), "tick": 30, "state_data": {"v": 1}}),
        content_type="application/json",
    )
    client.post(
        "/api/v1/internal/game/snapshot/",
        headers=_auth(),
        data=json.dumps({"match_id": str(match.id), "tick": 30, "state_data": {"v": 2}}),
        content_type="application/json",
    )
    snaps = GameStateSnapshot.objects.filter(match=match, tick=30)
    assert snaps.count() == 1
    assert snaps.first().state_data["v"] == 2


# --- Latest snapshot ---


@pytest.mark.django_db
def test_get_latest_snapshot_returns_none_when_empty(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/game/latest-snapshot/{match.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tick"] is None
    assert data["state_data"] is None


@pytest.mark.django_db
def test_get_latest_snapshot_returns_highest_tick(internal_api):
    client, match, _, _ = internal_api
    GameStateSnapshot.objects.create(match=match, tick=5, state_data={"t": 5})
    GameStateSnapshot.objects.create(match=match, tick=15, state_data={"t": 15})
    resp = client.get(
        f"/api/v1/internal/game/latest-snapshot/{match.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    assert resp.json()["tick"] == 15


@pytest.mark.django_db
def test_get_latest_snapshot_wrong_secret_returns_403(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/game/latest-snapshot/{match.id}/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


# --- Finalize match ---


@pytest.mark.django_db
def test_finalize_match_api_success(internal_api):
    client, match, user1, user2 = internal_api
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        resp = client.post(
            "/api/v1/internal/game/finalize/",
            headers=_auth(),
            data=json.dumps(
                {
                    "match_id": str(match.id),
                    "winner_id": str(user1.id),
                    "total_ticks": 100,
                    "final_state": _api_final_state(user1.id, user2.id),
                }
            ),
            content_type="application/json",
        )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.django_db
def test_finalize_match_api_creates_match_result(internal_api):
    client, match, user1, user2 = internal_api
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        client.post(
            "/api/v1/internal/game/finalize/",
            headers=_auth(),
            data=json.dumps(
                {
                    "match_id": str(match.id),
                    "winner_id": str(user1.id),
                    "total_ticks": 100,
                    "final_state": _api_final_state(user1.id, user2.id),
                }
            ),
            content_type="application/json",
        )
    assert MatchResult.objects.filter(match=match).exists()


@pytest.mark.django_db
def test_finalize_match_api_updates_status_to_finished(internal_api):
    client, match, user1, user2 = internal_api
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        client.post(
            "/api/v1/internal/game/finalize/",
            headers=_auth(),
            data=json.dumps(
                {
                    "match_id": str(match.id),
                    "winner_id": str(user1.id),
                    "total_ticks": 100,
                    "final_state": _api_final_state(user1.id, user2.id),
                }
            ),
            content_type="application/json",
        )
    match.refresh_from_db()
    assert match.status == Match.Status.FINISHED


@pytest.mark.django_db
def test_finalize_match_api_null_winner(internal_api):
    """Finalize with no winner (draw/timeout) should succeed."""
    client, match, user1, user2 = internal_api
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        resp = client.post(
            "/api/v1/internal/game/finalize/",
            headers=_auth(),
            data=json.dumps(
                {
                    "match_id": str(match.id),
                    "winner_id": None,
                    "total_ticks": 50,
                    "final_state": _api_final_state(user1.id, user2.id),
                }
            ),
            content_type="application/json",
        )
    assert resp.status_code == 200


# --- Cleanup match ---


@pytest.mark.django_db
@patch("apps.game.tasks.cleanup_redis_game_state")
def test_cleanup_match_api_success(mock_cleanup, internal_api):
    client, match, _, _ = internal_api
    resp = client.post(
        "/api/v1/internal/game/cleanup/",
        headers=_auth(),
        data=json.dumps({"match_id": str(match.id)}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    mock_cleanup.delay.assert_called_once_with(str(match.id))


# --- Get user ---


@pytest.mark.django_db
def test_get_user_success(internal_api):
    client, _, user1, _ = internal_api
    resp = client.get(f"/api/v1/internal/users/{user1.id}/", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == str(user1.id)
    assert data["username"] == user1.username
    assert "elo_rating" in data
    assert "is_active" in data


@pytest.mark.django_db
def test_get_user_not_found_returns_404(internal_api):
    client, _, _, _ = internal_api
    resp = client.get(f"/api/v1/internal/users/{uuid.uuid4()}/", headers=_auth())
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_user_banned_is_not_active(internal_api):
    client, _, user1, _ = internal_api
    user1.is_banned = True
    user1.save()
    resp = client.get(f"/api/v1/internal/users/{user1.id}/", headers=_auth())
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


# --- Verify player ---


@pytest.mark.django_db
def test_verify_player_is_member_and_active(internal_api):
    client, match, user1, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-player/{user1.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is True
    assert data["is_active"] is True


@pytest.mark.django_db
def test_verify_player_not_member(internal_api):
    client, match, _, _ = internal_api
    other = User.objects.create_user(email="other@test.com", username="other", password="testpass123")
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-player/{other.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    assert resp.json()["is_member"] is False


@pytest.mark.django_db
def test_verify_player_banned_user_not_active(internal_api):
    client, match, user1, _ = internal_api
    user1.is_banned = True
    user1.save()
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-player/{user1.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is True
    assert data["is_active"] is False


@pytest.mark.django_db
def test_verify_player_unknown_user_not_active(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-player/{uuid.uuid4()}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


# --- Match data ---


@pytest.mark.django_db
def test_get_match_data_success(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(f"/api/v1/internal/matches/{match.id}/data/", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert "max_players" in data
    assert "players" in data
    assert len(data["players"]) == 2


@pytest.mark.django_db
def test_get_match_data_includes_deck_snapshot_keys(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(f"/api/v1/internal/matches/{match.id}/data/", headers=_auth())
    player = resp.json()["players"][0]
    for key in (
        "unlocked_buildings",
        "unlocked_units",
        "ability_scrolls",
        "active_boosts",
        "ability_levels",
        "building_levels",
    ):
        assert key in player


@pytest.mark.django_db
def test_get_match_data_not_found_returns_404(internal_api):
    client, _, _, _ = internal_api
    resp = client.get(f"/api/v1/internal/matches/{uuid.uuid4()}/data/", headers=_auth())
    assert resp.status_code == 404


# --- Update match status ---


@pytest.mark.django_db
def test_update_match_status_success(internal_api):
    client, match, _, _ = internal_api
    resp = client.patch(
        f"/api/v1/internal/matches/{match.id}/status/",
        headers=_auth(),
        data=json.dumps({"status": "in_progress"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    match.refresh_from_db()
    assert match.status == "in_progress"


@pytest.mark.django_db
def test_update_match_status_not_found_returns_404(internal_api):
    client, _, _, _ = internal_api
    resp = client.patch(
        f"/api/v1/internal/matches/{uuid.uuid4()}/status/",
        headers=_auth(),
        data=json.dumps({"status": "in_progress"}),
        content_type="application/json",
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_update_match_status_wrong_secret_returns_403(internal_api):
    client, match, _, _ = internal_api
    resp = client.patch(
        f"/api/v1/internal/matches/{match.id}/status/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps({"status": "in_progress"}),
        content_type="application/json",
    )
    assert resp.status_code == 403


# --- Set player alive ---


@pytest.mark.django_db
def test_set_player_alive_false(internal_api):
    client, match, user1, _ = internal_api
    resp = client.patch(
        f"/api/v1/internal/matches/{match.id}/players/{user1.id}/alive/",
        headers=_auth(),
        data=json.dumps({"is_alive": False}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    mp = MatchPlayer.objects.get(match=match, user=user1)
    assert mp.is_alive is False
    assert mp.eliminated_at is not None


@pytest.mark.django_db
def test_set_player_alive_true_clears_eliminated_at(internal_api):
    client, match, user1, _ = internal_api
    mp = MatchPlayer.objects.get(match=match, user=user1)
    mp.is_alive = False
    mp.eliminated_at = timezone.now()
    mp.save()
    resp = client.patch(
        f"/api/v1/internal/matches/{match.id}/players/{user1.id}/alive/",
        headers=_auth(),
        data=json.dumps({"is_alive": True}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    mp.refresh_from_db()
    assert mp.is_alive is True
    assert mp.eliminated_at is None


@pytest.mark.django_db
def test_set_player_alive_not_found_returns_404(internal_api):
    client, match, _, _ = internal_api
    resp = client.patch(
        f"/api/v1/internal/matches/{match.id}/players/{uuid.uuid4()}/alive/",
        headers=_auth(),
        data=json.dumps({"is_alive": False}),
        content_type="application/json",
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_set_player_alive_wrong_secret_returns_403(internal_api):
    client, match, user1, _ = internal_api
    resp = client.patch(
        f"/api/v1/internal/matches/{match.id}/players/{user1.id}/alive/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps({"is_alive": False}),
        content_type="application/json",
    )
    assert resp.status_code == 403


# --- Active matches list ---


@pytest.mark.django_db
def test_list_active_matches_includes_selecting_and_in_progress(internal_api):
    client, match, _, _ = internal_api
    m2 = Match.objects.create(status=Match.Status.SELECTING, max_players=2)
    resp = client.get("/api/v1/internal/game/active-matches/", headers=_auth())
    assert resp.status_code == 200
    ids = resp.json()["match_ids"]
    assert str(match.id) in ids
    assert str(m2.id) in ids


@pytest.mark.django_db
def test_list_active_matches_excludes_finished(internal_api):
    client, _, _, _ = internal_api
    finished = Match.objects.create(status=Match.Status.FINISHED, max_players=2)
    resp = client.get("/api/v1/internal/game/active-matches/", headers=_auth())
    assert resp.status_code == 200
    assert str(finished.id) not in resp.json()["match_ids"]


@pytest.mark.django_db
def test_list_active_matches_wrong_secret_returns_403(internal_api):
    client, _, _, _ = internal_api
    resp = client.get(
        "/api/v1/internal/game/active-matches/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


# --- Anticheat report violation ---


@pytest.mark.django_db
def test_report_violation_success(internal_api):
    from apps.game.models import AnticheatViolation

    client, match, user1, _ = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/report-violation/",
        headers=_auth(),
        data=json.dumps(
            {
                "match_id": str(match.id),
                "player_id": str(user1.id),
                "violation_kind": "action_flood",
                "severity": "warn",
                "detail": "Too many actions per tick",
                "tick": 42,
            }
        ),
        content_type="application/json",
    )
    assert resp.status_code == 201
    assert resp.json()["ok"] is True
    assert AnticheatViolation.objects.filter(match=match, player=user1, violation_kind="action_flood").exists()


@pytest.mark.django_db
def test_report_violation_persists_all_fields(internal_api):
    from apps.game.models import AnticheatViolation

    client, match, user1, _ = internal_api
    client.post(
        "/api/v1/internal/anticheat/report-violation/",
        headers=_auth(),
        data=json.dumps(
            {
                "match_id": str(match.id),
                "player_id": str(user1.id),
                "violation_kind": "impossible_timing",
                "severity": "flag",
                "detail": "Action arrived before tick start",
                "tick": 77,
            }
        ),
        content_type="application/json",
    )
    v = AnticheatViolation.objects.get(match=match, player=user1, violation_kind="impossible_timing")
    assert v.severity == "flag"
    assert v.tick == 77


# --- Anticheat ban player ---


@pytest.mark.django_db
def test_ban_player_success(internal_api):
    client, _, _, user2 = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/ban-player/",
        headers=_auth(),
        data=json.dumps({"player_id": str(user2.id), "reason": "Repeated action flooding"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    user2.refresh_from_db()
    assert user2.is_banned is True
    assert user2.banned_reason == "Repeated action flooding"


@pytest.mark.django_db
def test_ban_player_not_found_returns_404(internal_api):
    client, _, _, _ = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/ban-player/",
        headers=_auth(),
        data=json.dumps({"player_id": str(uuid.uuid4()), "reason": "Cheating"}),
        content_type="application/json",
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_ban_player_wrong_secret_returns_403(internal_api):
    client, _, _, user2 = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/ban-player/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps({"player_id": str(user2.id), "reason": "Cheating"}),
        content_type="application/json",
    )
    assert resp.status_code == 403


# --- Anticheat compensate ---


@pytest.mark.django_db
def test_compensate_players_no_results_returns_not_found(internal_api):
    client, match, user1, _ = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/compensate/",
        headers=_auth(),
        data=json.dumps({"match_id": str(match.id), "player_ids": [str(user1.id)]}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert str(user1.id) in data["not_found"]


@pytest.mark.django_db
def test_compensate_reverses_elo_change(internal_api):
    client, match, user1, user2 = internal_api
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        finalize_match_results_sync(
            str(match.id),
            str(user1.id),
            100,
            {
                "players": {
                    str(user1.id): {
                        "is_alive": True,
                        "total_regions_conquered": 10,
                        "total_units_produced": 50,
                        "total_units_lost": 5,
                        "total_buildings_built": 3,
                        "eliminated_reason": "",
                        "eliminated_tick": 0,
                    },
                    str(user2.id): {
                        "is_alive": False,
                        "total_regions_conquered": 4,
                        "total_units_produced": 20,
                        "total_units_lost": 10,
                        "total_buildings_built": 1,
                        "eliminated_reason": "",
                        "eliminated_tick": 80,
                    },
                },
                "regions": {},
            },
        )
    user2.refresh_from_db()

    resp = client.post(
        "/api/v1/internal/anticheat/compensate/",
        headers=_auth(),
        data=json.dumps({"match_id": str(match.id), "player_ids": [str(user2.id)]}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = resp.json()
    assert str(user2.id) in data["compensated"]
    user2.refresh_from_db()
    # ELO should be back to 1000 (the original)
    assert user2.elo_rating == 1000


@pytest.mark.django_db
def test_compensate_wrong_secret_returns_403(internal_api):
    client, match, _, _ = internal_api
    resp = client.post(
        "/api/v1/internal/anticheat/compensate/",
        headers={"X-Internal-Secret": WRONG_SECRET},
        data=json.dumps({"match_id": str(match.id), "player_ids": []}),
        content_type="application/json",
    )
    assert resp.status_code == 403


# --- Neighbor map ---


@pytest.mark.django_db
@patch("apps.geo.models.Region.objects")
def test_neighbor_map_returns_dict(mock_qs_manager, internal_api):
    client, _, _, _ = internal_api
    mock_qs_manager.prefetch_related.return_value.all.return_value = []
    resp = client.get("/api/v1/internal/regions/neighbors/", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert "neighbors" in data
    assert isinstance(data["neighbors"], dict)


@pytest.mark.django_db
def test_neighbor_map_wrong_secret_returns_403(internal_api):
    client, _, _, _ = internal_api
    resp = client.get(
        "/api/v1/internal/regions/neighbors/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GameController view endpoints (JWT-authenticated)
# ---------------------------------------------------------------------------


def _jwt_header(user):
    from ninja_jwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    return f"Bearer {str(refresh.access_token)}"


@pytest.fixture
def game_view_setup(db):
    GameSettings.get()
    user1 = User.objects.create_user(
        email="gview1@test.com", username="gview_user1", password="testpass123", elo_rating=1200
    )
    user2 = User.objects.create_user(
        email="gview2@test.com", username="gview_user2", password="testpass123", elo_rating=900
    )
    match = Match.objects.create(
        status=Match.Status.FINISHED,
        max_players=2,
        started_at=timezone.now() - timedelta(minutes=15),
        finished_at=timezone.now(),
    )
    MatchPlayer.objects.create(match=match, user=user1, color="#FF0000")
    MatchPlayer.objects.create(match=match, user=user2, color="#0000FF")
    return match, user1, user2


@pytest.mark.django_db
def test_get_result_unauthenticated_returns_401(client, game_view_setup):
    match, _, _ = game_view_setup
    resp = client.get(f"/api/v1/game/results/{match.id}/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_get_result_not_found_returns_404(client, game_view_setup):
    _, user1, _ = game_view_setup
    import uuid as _uuid

    resp = client.get(
        f"/api/v1/game/results/{_uuid.uuid4()}/",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_result_returns_match_result(client, game_view_setup):
    from apps.game.models import MatchResult

    match, user1, user2 = game_view_setup
    MatchResult.objects.create(match=match, total_ticks=150, duration_seconds=600)
    resp = client.get(
        f"/api/v1/game/results/{match.id}/",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert str(data["match_id"]) == str(match.id)
    assert data["total_ticks"] == 150


@pytest.mark.django_db
def test_list_snapshots_unauthenticated_returns_401(client, game_view_setup):
    match, _, _ = game_view_setup
    resp = client.get(f"/api/v1/game/snapshots/{match.id}/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_list_snapshots_returns_empty_for_no_snapshots(client, game_view_setup):
    match, user1, _ = game_view_setup
    resp = client.get(
        f"/api/v1/game/snapshots/{match.id}/",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.django_db
def test_list_snapshots_returns_ordered_ticks(client, game_view_setup):
    from apps.game.models import GameStateSnapshot

    match, user1, _ = game_view_setup
    GameStateSnapshot.objects.create(match=match, tick=30, state_data={})
    GameStateSnapshot.objects.create(match=match, tick=10, state_data={})
    GameStateSnapshot.objects.create(match=match, tick=20, state_data={})
    resp = client.get(
        f"/api/v1/game/snapshots/{match.id}/",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 200
    ticks = [item["tick"] for item in resp.json()]
    assert ticks == [10, 20, 30]


@pytest.mark.django_db
def test_get_snapshot_unauthenticated_returns_401(client, game_view_setup):
    match, _, _ = game_view_setup
    resp = client.get(f"/api/v1/game/snapshots/{match.id}/5/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_get_snapshot_returns_404_when_missing(client, game_view_setup):
    match, user1, _ = game_view_setup
    resp = client.get(
        f"/api/v1/game/snapshots/{match.id}/999/",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_snapshot_returns_state_data(client, game_view_setup):
    from apps.game.models import GameStateSnapshot

    match, user1, _ = game_view_setup
    GameStateSnapshot.objects.create(match=match, tick=50, state_data={"regions": {"r1": 1}})
    resp = client.get(
        f"/api/v1/game/snapshots/{match.id}/50/",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tick"] == 50
    assert "state_data" in data


# ---------------------------------------------------------------------------
# ShareController view endpoints
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_create_share_link_unauthenticated_returns_401(client):
    resp = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "match_result", "resource_id": str(uuid.uuid4())}),
        content_type="application/json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_share_link_nonexistent_match_returns_404(client, game_view_setup):
    _, user1, _ = game_view_setup
    resp = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "match_result", "resource_id": str(uuid.uuid4())}),
        content_type="application/json",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_create_share_link_unfinished_match_returns_404(client, game_view_setup):
    match, user1, _ = game_view_setup
    match.status = Match.Status.IN_PROGRESS
    match.save()
    resp = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "match_result", "resource_id": str(match.id)}),
        content_type="application/json",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_create_share_link_unknown_resource_type_returns_400(client, game_view_setup):
    match, user1, _ = game_view_setup
    resp = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "unknown_type", "resource_id": str(match.id)}),
        content_type="application/json",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_share_link_success(client, game_view_setup):
    from apps.game.models import ShareLink

    match, user1, _ = game_view_setup
    resp = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "match_result", "resource_id": str(match.id)}),
        content_type="application/json",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["resource_type"] == "match_result"
    assert ShareLink.objects.filter(token=data["token"]).exists()


@pytest.mark.django_db
def test_create_share_link_idempotent(client, game_view_setup):
    match, user1, _ = game_view_setup
    resp1 = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "match_result", "resource_id": str(match.id)}),
        content_type="application/json",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    resp2 = client.post(
        "/api/v1/share/create/",
        data=json.dumps({"resource_type": "match_result", "resource_id": str(match.id)}),
        content_type="application/json",
        HTTP_AUTHORIZATION=_jwt_header(user1),
    )
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["token"] == resp2.json()["token"]


@pytest.mark.django_db
def test_get_shared_resource_not_found_returns_404(client):
    resp = client.get("/api/v1/share/invalid-token-xyz/")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_shared_resource_returns_match_data(client, game_view_setup):
    from apps.game.models import ShareLink

    match, user1, _ = game_view_setup
    link = ShareLink.objects.create(
        token=ShareLink.generate_token(),
        resource_type="match_result",
        resource_id=match.id,
        created_by=user1,
    )
    resp = client.get(f"/api/v1/share/{link.token}/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["resource_type"] == "match_result"
    assert "match" in data
    assert str(data["match"]["id"]) == str(match.id)


@pytest.mark.django_db
def test_get_shared_snapshot_wrong_type_returns_400(client, game_view_setup):
    from apps.game.models import ShareLink

    match, user1, _ = game_view_setup
    # Create link with a mocked resource_type to trigger the guard in get_shared_snapshot
    link = ShareLink.objects.create(
        token=ShareLink.generate_token(),
        resource_type="match_result",
        resource_id=match.id,
        created_by=user1,
    )
    # Manually override type in DB to trigger the guard
    ShareLink.objects.filter(pk=link.pk).update(resource_type="other")
    resp = client.get(f"/api/v1/share/{link.token}/snapshots/5/")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_get_shared_snapshot_success(client, game_view_setup):
    from apps.game.models import GameStateSnapshot, ShareLink

    match, user1, _ = game_view_setup
    GameStateSnapshot.objects.create(match=match, tick=25, state_data={"t": 25})
    link = ShareLink.objects.create(
        token=ShareLink.generate_token(),
        resource_type="match_result",
        resource_id=match.id,
        created_by=user1,
    )
    resp = client.get(f"/api/v1/share/{link.token}/snapshots/25/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tick"] == 25


# ---------------------------------------------------------------------------
# save_game_snapshot Celery task
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_save_game_snapshot_task_creates_snapshot():
    from apps.game.tasks import save_game_snapshot

    GameSettings.get()
    match = Match.objects.create(status=Match.Status.IN_PROGRESS, max_players=2)
    save_game_snapshot(str(match.id), 55, {"players": {}, "regions": {}})
    from apps.game.models import GameStateSnapshot

    assert GameStateSnapshot.objects.filter(match=match, tick=55).exists()


@pytest.mark.django_db
def test_save_game_snapshot_task_upserts():
    from apps.game.tasks import save_game_snapshot

    GameSettings.get()
    match = Match.objects.create(status=Match.Status.IN_PROGRESS, max_players=2)
    save_game_snapshot(str(match.id), 100, {"v": 1})
    save_game_snapshot(str(match.id), 100, {"v": 2})
    from apps.game.models import GameStateSnapshot

    snaps = GameStateSnapshot.objects.filter(match=match, tick=100)
    assert snaps.count() == 1
    assert snaps.first().state_data["v"] == 2


# ---------------------------------------------------------------------------
# finalize_match_results Celery task wrapper
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_finalize_match_results_celery_task(two_player_match):
    from apps.game.tasks import finalize_match_results

    match, user1, user2 = two_player_match
    with (
        patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip")),
        patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip")),
    ):
        finalize_match_results(
            str(match.id),
            str(user1.id),
            100,
            _make_final_state(user1.id, user2.id),
        )
    match.refresh_from_db()
    assert match.status == Match.Status.FINISHED


# ---------------------------------------------------------------------------
# Internal API — system modules endpoint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_system_modules_success(internal_api):
    from apps.game_config.models import SystemModule

    client, _, _, _ = internal_api
    SystemModule.objects.create(
        slug="test-gateway-mod",
        name="Test Gateway Mod",
        affects_gateway=True,
        enabled=True,
        config={"some_key": "value"},
    )
    resp = client.get("/api/v1/internal/system-modules/", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert "test-gateway-mod" in data
    assert data["test-gateway-mod"]["enabled"] is True


@pytest.mark.django_db
def test_get_system_modules_excludes_non_gateway(internal_api):
    from apps.game_config.models import SystemModule

    client, _, _, _ = internal_api
    SystemModule.objects.create(
        slug="backend-only-mod",
        name="Backend Only",
        affects_gateway=False,
        enabled=True,
    )
    resp = client.get("/api/v1/internal/system-modules/", headers=_auth())
    assert resp.status_code == 200
    data = resp.json()
    assert "backend-only-mod" not in data


@pytest.mark.django_db
def test_get_system_modules_wrong_secret_returns_403(internal_api):
    client, _, _, _ = internal_api
    resp = client.get(
        "/api/v1/internal/system-modules/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# cleanup_stale_queue_entries task
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cleanup_stale_queue_entries_removes_old_entries():
    from apps.game.tasks import cleanup_stale_queue_entries
    from apps.matchmaking.models import MatchQueue

    GameSettings.get()
    user = User.objects.create_user(email="queue_user@test.com", username="queue_user", password="testpass123")
    entry = MatchQueue.objects.create(user=user)
    MatchQueue.objects.filter(pk=entry.pk).update(joined_at=timezone.now() - timedelta(hours=1))
    cleanup_stale_queue_entries()
    assert not MatchQueue.objects.filter(pk=entry.pk).exists()


@pytest.mark.django_db
def test_cleanup_stale_queue_entries_keeps_recent_entries():
    from apps.game.tasks import cleanup_stale_queue_entries
    from apps.matchmaking.models import MatchQueue

    GameSettings.get()
    user = User.objects.create_user(email="queue_fresh@test.com", username="queue_fresh", password="testpass123")
    entry = MatchQueue.objects.create(user=user)
    cleanup_stale_queue_entries()
    assert MatchQueue.objects.filter(pk=entry.pk).exists()


# ---------------------------------------------------------------------------
# verify_spectator internal API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_verify_spectator_wrong_secret_returns_403(internal_api):
    client, match, user1, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-spectator/{user1.id}/",
        headers={"X-Internal-Secret": WRONG_SECRET},
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_verify_spectator_banned_user_returns_false(internal_api):
    client, match, user1, _ = internal_api
    user1.is_banned = True
    user1.save()
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-spectator/{user1.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is False
    assert data["is_active"] is False


@pytest.mark.django_db
def test_verify_spectator_unknown_user_returns_false(internal_api):
    client, match, _, _ = internal_api
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-spectator/{uuid.uuid4()}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is False
    assert data["is_active"] is False


@pytest.mark.django_db
def test_verify_spectator_finished_match_returns_false(internal_api):
    """A user cannot spectate a match that is already finished."""
    client, match, user1, _ = internal_api
    match.status = Match.Status.FINISHED
    match.save()
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-spectator/{user1.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is False


@pytest.mark.django_db
def test_verify_spectator_friend_of_player_allowed(internal_api):
    from apps.accounts.models import Friendship

    client, match, user1, _ = internal_api
    spectator = User.objects.create_user(email="spectator@test.com", username="spec_user", password="testpass123")
    Friendship.objects.create(
        from_user=spectator,
        to_user=user1,
        status=Friendship.Status.ACCEPTED,
    )
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-spectator/{spectator.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is True
    assert data["is_active"] is True


@pytest.mark.django_db
def test_verify_spectator_non_friend_not_allowed(internal_api):
    client, match, _, _ = internal_api
    stranger = User.objects.create_user(email="stranger@test.com", username="stranger_user", password="testpass123")
    resp = client.get(
        f"/api/v1/internal/matches/{match.id}/verify-spectator/{stranger.id}/",
        headers=_auth(),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_member"] is False


# ---------------------------------------------------------------------------
# save_game_snapshot task
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_save_game_snapshot_creates_snapshot():
    from apps.game.tasks import save_game_snapshot

    GameSettings.get()
    match = Match.objects.create(status=Match.Status.IN_PROGRESS, max_players=2)
    state = {"players": {}, "regions": {}}
    save_game_snapshot(str(match.id), 50, state)
    assert GameStateSnapshot.objects.filter(match=match, tick=50).exists()


@pytest.mark.django_db
def test_save_game_snapshot_upserts_on_duplicate_tick():
    from apps.game.tasks import save_game_snapshot

    GameSettings.get()
    match = Match.objects.create(status=Match.Status.IN_PROGRESS, max_players=2)
    save_game_snapshot(str(match.id), 10, {"version": 1})
    save_game_snapshot(str(match.id), 10, {"version": 2})
    snaps = GameStateSnapshot.objects.filter(match=match, tick=10)
    assert snaps.count() == 1
    assert snaps.first().state_data == {"version": 2}


# ---------------------------------------------------------------------------
# finalize_match_results (Celery task wrapper)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip"))
@patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip"))
def test_finalize_match_results_task_delegates_correctly(_mock_dev, _mock_inv, two_player_match):
    from apps.game.tasks import finalize_match_results

    match, user1, user2 = two_player_match
    final_state = _make_final_state(user1.id, user2.id)
    finalize_match_results(str(match.id), str(user1.id), 200, final_state)
    match.refresh_from_db()
    assert match.status == Match.Status.FINISHED


# ---------------------------------------------------------------------------
# _award_match_xp — XP and level-up logic
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_award_match_xp_winner_gets_more_xp():
    from unittest.mock import MagicMock, patch

    from apps.game.tasks import _award_match_xp

    winner = User.objects.create_user(email="xp_win@test.com", username="xpwinner", password="x", experience=0)
    loser = User.objects.create_user(email="xp_lose@test.com", username="xploser", password="x", experience=0)

    mp_winner = MagicMock()
    mp_winner.user = winner
    mp_loser = MagicMock()
    mp_loser.user = loser

    player_rows = [
        {"pid": str(winner.id), "is_bot": False, "match_player": mp_winner},
        {"pid": str(loser.id), "is_bot": False, "match_player": mp_loser},
    ]

    with patch("apps.clans.tasks.award_clan_xp.delay"):
        _award_match_xp(player_rows, str(winner.id))

    winner.refresh_from_db()
    loser.refresh_from_db()
    assert winner.experience == 50
    assert loser.experience == 20


@pytest.mark.django_db
def test_award_match_xp_bots_skipped():
    from unittest.mock import MagicMock, patch

    from apps.game.tasks import _award_match_xp

    human = User.objects.create_user(email="xp_human@test.com", username="xphuman", password="x", experience=0)
    bot = User.objects.create_user(email="xp_bot@test.com", username="xpbot", password="x", experience=0, is_bot=True)

    mp_human = MagicMock()
    mp_human.user = human
    mp_bot = MagicMock()
    mp_bot.user = bot

    player_rows = [
        {"pid": str(human.id), "is_bot": False, "match_player": mp_human},
        {"pid": str(bot.id), "is_bot": True, "match_player": mp_bot},
    ]

    with patch("apps.clans.tasks.award_clan_xp.delay"):
        _award_match_xp(player_rows, str(human.id))

    bot.refresh_from_db()
    assert bot.experience == 0


@pytest.mark.django_db
def test_award_match_xp_level_up_triggered():
    from unittest.mock import MagicMock, patch

    from apps.accounts.models import AccountLevel
    from apps.game.tasks import _award_match_xp

    AccountLevel.objects.get_or_create(level=2, defaults={"experience_required": 40})
    user = User.objects.create_user(email="xp_lvlup@test.com", username="xplvlup", password="x", experience=0, level=1)

    mp = MagicMock()
    mp.user = user

    player_rows = [{"pid": str(user.id), "is_bot": False, "match_player": mp}]

    with patch("apps.clans.tasks.award_clan_xp.delay"):
        _award_match_xp(player_rows, str(user.id))  # winner gets 50 XP

    user.refresh_from_db()
    assert user.experience == 50
    assert user.level == 2


# ---------------------------------------------------------------------------
# _resolve_clan_war — clan war resolution in finalize
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip"))
@patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip"))
def test_finalize_triggers_clan_war_resolution_when_war_exists(_mock_dev, _mock_inv, two_player_match):
    from apps.clans.models import Clan, ClanWar, ClanWarParticipant

    match, user1, user2 = two_player_match

    clan1 = Clan.objects.create(name="War Clan A", tag="WCA", leader=user1, elo_rating=1000)
    clan2 = Clan.objects.create(name="War Clan B", tag="WCB", leader=user2, elo_rating=1000)

    war = ClanWar.objects.create(
        challenger=clan1,
        defender=clan2,
        status=ClanWar.Status.IN_PROGRESS,
        match=match,
    )
    ClanWarParticipant.objects.create(war=war, clan=clan1, user=user1)
    ClanWarParticipant.objects.create(war=war, clan=clan2, user=user2)

    with patch("apps.clans.tasks.calculate_clan_war_elo.delay") as mock_elo:
        finalize_match_results_sync(
            str(match.id),
            str(user1.id),
            200,
            _make_final_state(user1.id, user2.id),
        )

    war.refresh_from_db()
    assert war.status == ClanWar.Status.FINISHED
    assert war.winner == clan1
    mock_elo.assert_called_once_with(str(war.pk))


@pytest.mark.django_db
@patch("apps.inventory.tasks.generate_match_drops", side_effect=Exception("skip"))
@patch("apps.developers.tasks.dispatch_webhook_event", side_effect=Exception("skip"))
def test_finalize_clan_war_draw_refunds_wager(_mock_dev, _mock_inv, two_player_match):
    from apps.clans.models import Clan, ClanWar, ClanWarParticipant

    match, user1, user2 = two_player_match

    clan1 = Clan.objects.create(name="Draw Clan A", tag="DCA", leader=user1, treasury_gold=0)
    clan2 = Clan.objects.create(name="Draw Clan B", tag="DCB", leader=user2, treasury_gold=0)

    war = ClanWar.objects.create(
        challenger=clan1,
        defender=clan2,
        status=ClanWar.Status.IN_PROGRESS,
        match=match,
        wager_gold=100,
    )
    ClanWarParticipant.objects.create(war=war, clan=clan1, user=user1)
    ClanWarParticipant.objects.create(war=war, clan=clan2, user=user2)

    with patch("apps.clans.tasks.calculate_clan_war_elo.delay"):
        finalize_match_results_sync(str(match.id), None, 200, _make_final_state(user1.id, user2.id))

    clan1.refresh_from_db()
    clan2.refresh_from_db()
    # Both clans should have received their wager back (100 each)
    assert clan1.treasury_gold == 100
    assert clan2.treasury_gold == 100
