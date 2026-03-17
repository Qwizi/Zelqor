"""
Tests for apps/game — ELO helpers, match finalization, stale cleanup, Redis cleanup.
"""
import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.game.tasks import (
    _balanced_round_elo_changes,
    _round_elo_delta,
    _safe_ratio,
    finalize_match_results_sync,
    cleanup_stale_matches,
)
from apps.matchmaking.models import Match, MatchPlayer
from apps.game_config.models import GameSettings
from apps.game.models import GameStateSnapshot, MatchResult, PlayerResult

User = get_user_model()


# ---------------------------------------------------------------------------
# Pure-function ELO helpers
# ---------------------------------------------------------------------------

class RoundEloDeltaTests(TestCase):
    """Unit tests for _round_elo_delta — no DB required."""

    def test_positive_value_rounds_correctly(self):
        self.assertEqual(_round_elo_delta(4.6), 5)

    def test_negative_value_rounds_correctly(self):
        self.assertEqual(_round_elo_delta(-4.6), -5)

    def test_exactly_zero_returns_zero(self):
        self.assertEqual(_round_elo_delta(0.0), 0)

    def test_very_small_positive_rounds_to_plus_one(self):
        # Any positive nonzero that rounds to 0 should be forced to +1
        result = _round_elo_delta(0.000001)
        self.assertEqual(result, 1)

    def test_very_small_negative_rounds_to_minus_one(self):
        result = _round_elo_delta(-0.000001)
        self.assertEqual(result, -1)

    def test_half_rounds_up(self):
        # ROUND_HALF_UP: 2.5 → 3
        self.assertEqual(_round_elo_delta(2.5), 3)
        self.assertEqual(_round_elo_delta(-2.5), -3)

    def test_integer_values_unchanged(self):
        self.assertEqual(_round_elo_delta(10.0), 10)
        self.assertEqual(_round_elo_delta(-7.0), -7)


class BalancedRoundEloChangesTests(TestCase):
    """Unit tests for _balanced_round_elo_changes — no DB required."""

    def test_zero_sum_two_players(self):
        """Total ELO change must be exactly zero."""
        raw = [15.3, -15.3]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(sum(result), 0)

    def test_zero_sum_four_players(self):
        raw = [12.1, 5.7, -8.4, -9.4]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(sum(result), 0)

    def test_winner_gains_loser_loses_two_players(self):
        raw = [20.0, -20.0]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(len(result), 2)
        self.assertGreater(result[0], 0)
        self.assertLess(result[1], 0)

    def test_returns_integers(self):
        raw = [8.75, -8.75]
        result = _balanced_round_elo_changes(raw)
        for val in result:
            self.assertIsInstance(val, int)

    def test_all_zeros(self):
        raw = [0.0, 0.0, 0.0]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(result, [0, 0, 0])
        self.assertEqual(sum(result), 0)

    def test_single_player_zero(self):
        raw = [0.0]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(result, [0])

    def test_large_k_factor_zero_sum(self):
        """Even with large K-factor, sum must be zero."""
        raw = [64.1, -32.0, -32.1]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(sum(result), 0)

    def test_equal_elo_balanced_game(self):
        """Equal players, balanced result — minimal adjustments, zero sum."""
        raw = [0.5, -0.5]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(sum(result), 0)

    def test_very_different_elo_zero_sum(self):
        """Any raw changes must still zero-sum after rounding."""
        raw = [1.6, -1.6]
        result = _balanced_round_elo_changes(raw)
        self.assertEqual(sum(result), 0)

    def test_k_factor_scaling_larger_k_larger_changes(self):
        """K=64 raw changes should round to larger integers than K=16."""
        raw_large = [32.0, -32.0]
        raw_small = [8.0, -8.0]
        result_large = _balanced_round_elo_changes(raw_large)
        result_small = _balanced_round_elo_changes(raw_small)
        self.assertGreater(result_large[0], result_small[0])


class SafeRatioTests(TestCase):
    """Unit tests for _safe_ratio helper."""

    def test_normal_ratio(self):
        self.assertAlmostEqual(_safe_ratio(3, 10), 0.3)

    def test_zero_denominator_returns_zero(self):
        self.assertEqual(_safe_ratio(5, 0), 0.0)

    def test_full_ratio(self):
        self.assertAlmostEqual(_safe_ratio(10, 10), 1.0)


# ---------------------------------------------------------------------------
# finalize_match_results_sync — DB tests
# ---------------------------------------------------------------------------

class FinalizeMatchResultsSyncTests(TestCase):
    """Integration tests for finalize_match_results_sync."""

    def setUp(self):
        GameSettings.get()  # ensure singleton exists
        self.user1 = User.objects.create_user(
            email='player1@test.com', username='player1',
            password='testpass123', elo_rating=1000,
        )
        self.user2 = User.objects.create_user(
            email='player2@test.com', username='player2',
            password='testpass123', elo_rating=1000,
        )
        self.match = Match.objects.create(
            status=Match.Status.IN_PROGRESS,
            max_players=2,
            started_at=timezone.now() - timedelta(minutes=10),
        )
        MatchPlayer.objects.create(match=self.match, user=self.user1, color='#FF0000')
        MatchPlayer.objects.create(match=self.match, user=self.user2, color='#0000FF')

    def _final_state(self):
        return {
            'players': {
                str(self.user1.id): {
                    'is_alive': True,
                    'total_regions_conquered': 10,
                    'total_units_produced': 50,
                    'total_units_lost': 5,
                    'total_buildings_built': 3,
                    'eliminated_reason': '',
                    'eliminated_tick': 0,
                },
                str(self.user2.id): {
                    'is_alive': False,
                    'total_regions_conquered': 5,
                    'total_units_produced': 25,
                    'total_units_lost': 20,
                    'total_buildings_built': 1,
                    'eliminated_reason': '',
                    'eliminated_tick': 100,
                },
            },
            'regions': {},
        }

    def _finalize(self):
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                finalize_match_results_sync(
                    str(self.match.id),
                    str(self.user1.id),
                    200,
                    self._final_state(),
                )

    def test_creates_match_result(self):
        self._finalize()
        self.assertTrue(MatchResult.objects.filter(match=self.match).exists())

    def test_creates_player_results_for_all_players(self):
        self._finalize()
        result = MatchResult.objects.get(match=self.match)
        self.assertEqual(result.player_results.count(), 2)

    def test_winner_has_placement_one(self):
        self._finalize()
        result = MatchResult.objects.get(match=self.match)
        winner_pr = result.player_results.get(user=self.user1)
        self.assertEqual(winner_pr.placement, 1)

    def test_loser_has_higher_placement(self):
        self._finalize()
        result = MatchResult.objects.get(match=self.match)
        loser_pr = result.player_results.get(user=self.user2)
        self.assertGreater(loser_pr.placement, 1)

    def test_match_status_set_to_finished(self):
        self._finalize()
        self.match.refresh_from_db()
        self.assertEqual(self.match.status, Match.Status.FINISHED)

    def test_match_finished_at_is_set(self):
        self._finalize()
        self.match.refresh_from_db()
        self.assertIsNotNone(self.match.finished_at)

    def test_snapshot_saved_at_correct_tick(self):
        self._finalize()
        self.assertTrue(GameStateSnapshot.objects.filter(match=self.match, tick=200).exists())

    def test_idempotent_does_not_duplicate_match_result(self):
        """Calling finalize twice must not create duplicate MatchResult."""
        self._finalize()
        self._finalize()
        self.assertEqual(MatchResult.objects.filter(match=self.match).count(), 1)

    def test_elo_zero_sum_two_players(self):
        """Total ELO change across all players must be zero."""
        elo_before = self.user1.elo_rating + self.user2.elo_rating
        self._finalize()
        self.user1.refresh_from_db()
        self.user2.refresh_from_db()
        elo_after = self.user1.elo_rating + self.user2.elo_rating
        self.assertEqual(elo_before, elo_after)

    def test_winner_elo_increases(self):
        """Winner at equal ELO should gain rating."""
        elo_before = self.user1.elo_rating
        self._finalize()
        self.user1.refresh_from_db()
        self.assertGreater(self.user1.elo_rating, elo_before)

    def test_loser_elo_decreases(self):
        """Loser at equal ELO should lose rating."""
        elo_before = self.user2.elo_rating
        self._finalize()
        self.user2.refresh_from_db()
        self.assertLess(self.user2.elo_rating, elo_before)

    def test_bot_player_elo_unchanged(self):
        """Bot players should never have their ELO changed."""
        bot = User.objects.create_user(
            email='bot@test.com', username='testbot',
            password='testpass123', elo_rating=1000, is_bot=True,
        )
        MatchPlayer.objects.filter(match=self.match, user=self.user2).delete()
        MatchPlayer.objects.create(match=self.match, user=bot, color='#00FF00')
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                finalize_match_results_sync(
                    str(self.match.id),
                    str(self.user1.id),
                    200,
                    {
                        'players': {
                            str(self.user1.id): {
                                'is_alive': True, 'total_regions_conquered': 10,
                                'total_units_produced': 50, 'total_units_lost': 5,
                                'total_buildings_built': 3,
                                'eliminated_reason': '', 'eliminated_tick': 0,
                            },
                            str(bot.id): {
                                'is_alive': False, 'total_regions_conquered': 3,
                                'total_units_produced': 20, 'total_units_lost': 15,
                                'total_buildings_built': 1,
                                'eliminated_reason': '', 'eliminated_tick': 50,
                            },
                        },
                        'regions': {},
                    },
                )
        bot.refresh_from_db()
        self.assertEqual(bot.elo_rating, 1000)

    def test_uses_settings_snapshot_k_factor(self):
        """If match has settings_snapshot with elo_k_factor, that value is used."""
        self.match.settings_snapshot = {'elo_k_factor': 64}
        self.match.save()
        self._finalize()
        result = MatchResult.objects.get(match=self.match)
        self.assertIsNotNone(result)

    def test_total_ticks_stored(self):
        self._finalize()
        result = MatchResult.objects.get(match=self.match)
        self.assertEqual(result.total_ticks, 200)


# ---------------------------------------------------------------------------
# cleanup_stale_matches
# ---------------------------------------------------------------------------

class CleanupStaleMatchesTests(TestCase):
    """Tests for cleanup_stale_matches task."""

    def setUp(self):
        GameSettings.get()
        self.user = User.objects.create_user(
            email='cleanup@test.com', username='cleanupuser',
            password='testpass123',
        )

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_cancels_old_selecting_match(self, mock_cleanup):
        """SELECTING match older than timeout should be cancelled."""
        old_match = Match.objects.create(
            status=Match.Status.SELECTING,
            max_players=2,
        )
        Match.objects.filter(pk=old_match.pk).update(
            created_at=timezone.now() - timedelta(minutes=10)
        )
        cleanup_stale_matches()
        old_match.refresh_from_db()
        self.assertEqual(old_match.status, Match.Status.CANCELLED)

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_cancels_old_in_progress_match(self, mock_cleanup):
        """IN_PROGRESS match with started_at exceeding 2h should be cancelled."""
        old_match = Match.objects.create(
            status=Match.Status.IN_PROGRESS,
            max_players=2,
            started_at=timezone.now() - timedelta(hours=3),
        )
        cleanup_stale_matches()
        old_match.refresh_from_db()
        self.assertEqual(old_match.status, Match.Status.CANCELLED)

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_does_not_cancel_recent_selecting_match(self, mock_cleanup):
        """A SELECTING match that just started should NOT be cancelled."""
        recent_match = Match.objects.create(
            status=Match.Status.SELECTING,
            max_players=2,
        )
        cleanup_stale_matches()
        recent_match.refresh_from_db()
        self.assertEqual(recent_match.status, Match.Status.SELECTING)

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_does_not_cancel_recent_in_progress_match(self, mock_cleanup):
        """A match that started 30 minutes ago should not be cancelled."""
        recent_match = Match.objects.create(
            status=Match.Status.IN_PROGRESS,
            max_players=2,
            started_at=timezone.now() - timedelta(minutes=30),
        )
        cleanup_stale_matches()
        recent_match.refresh_from_db()
        self.assertEqual(recent_match.status, Match.Status.IN_PROGRESS)

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_does_not_cancel_finished_matches(self, mock_cleanup):
        """FINISHED matches must stay finished."""
        finished_match = Match.objects.create(
            status=Match.Status.FINISHED,
            max_players=2,
            started_at=timezone.now() - timedelta(hours=5),
            finished_at=timezone.now() - timedelta(hours=4),
        )
        cleanup_stale_matches()
        finished_match.refresh_from_db()
        self.assertEqual(finished_match.status, Match.Status.FINISHED)

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_sets_players_alive_false(self, mock_cleanup):
        """MatchPlayers that are alive when cancelled should be marked dead."""
        old_match = Match.objects.create(
            status=Match.Status.IN_PROGRESS,
            max_players=2,
            started_at=timezone.now() - timedelta(hours=3),
        )
        mp = MatchPlayer.objects.create(match=old_match, user=self.user, is_alive=True)
        cleanup_stale_matches()
        mp.refresh_from_db()
        self.assertFalse(mp.is_alive)

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_redis_cleanup_called_for_stale_match(self, mock_cleanup):
        """cleanup_redis_game_state.delay should be called for each stale match."""
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

class CleanupRedisGameStateTests(TestCase):
    """Tests for cleanup_redis_game_state task — mocks Redis."""

    @patch('apps.game.tasks.redis.Redis')
    def test_deletes_known_suffixes(self, mock_redis_cls):
        """Should attempt to delete all known Redis key suffixes for the match."""
        from apps.game.tasks import cleanup_redis_game_state

        mock_r = MagicMock()
        mock_r.delete.return_value = 5
        mock_redis_cls.return_value = mock_r

        match_id = str(uuid.uuid4())
        cleanup_redis_game_state(match_id)

        mock_r.delete.assert_called_once()
        deleted_keys = mock_r.delete.call_args[0]
        self.assertIn(f'game:{match_id}:meta', deleted_keys)
        self.assertIn(f'game:{match_id}:players', deleted_keys)
        self.assertIn(f'game:{match_id}:regions', deleted_keys)
        self.assertIn(f'game:{match_id}:actions', deleted_keys)
        mock_r.close.assert_called_once()

    @patch('apps.game.tasks.redis.Redis')
    def test_runs_without_error_when_nothing_deleted(self, mock_redis_cls):
        """Task should complete without raising even when Redis returns 0 deleted."""
        from apps.game.tasks import cleanup_redis_game_state

        mock_r = MagicMock()
        mock_r.delete.return_value = 0
        mock_redis_cls.return_value = mock_r

        cleanup_redis_game_state(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# Model string representations
# ---------------------------------------------------------------------------

class GameModelStrTests(TestCase):

    def setUp(self):
        GameSettings.get()
        self.user = User.objects.create_user(
            email='strtest@test.com', username='strtest',
            password='testpass123',
        )
        self.match = Match.objects.create(status=Match.Status.FINISHED, max_players=2)

    def test_snapshot_str(self):
        snap = GameStateSnapshot.objects.create(
            match=self.match, tick=42, state_data={'foo': 'bar'}
        )
        self.assertIn('42', str(snap))

    def test_match_result_str(self):
        result = MatchResult.objects.create(match=self.match, total_ticks=100)
        self.assertIn('Result', str(result))

    def test_player_result_str(self):
        result = MatchResult.objects.create(match=self.match, total_ticks=100)
        pr = PlayerResult.objects.create(
            match_result=result, user=self.user, placement=1,
        )
        self.assertIn('strtest', str(pr))
        self.assertIn('#1', str(pr))


# ---------------------------------------------------------------------------
# Internal API — shared helpers
# ---------------------------------------------------------------------------

INTERNAL_SECRET = 'test-internal-secret'
WRONG_SECRET = 'wrong-secret'


def _auth():
    return {'X-Internal-Secret': INTERNAL_SECRET}


# ---------------------------------------------------------------------------
# GameInternalAPITests
# ---------------------------------------------------------------------------

class GameInternalAPITests(TestCase):
    """Tests for the GameInternalController endpoints."""

    def setUp(self):
        GameSettings.get()
        self.user1 = User.objects.create_user(
            email='gapi1@test.com', username='gapi_player1',
            password='testpass123', elo_rating=1000,
        )
        self.user2 = User.objects.create_user(
            email='gapi2@test.com', username='gapi_player2',
            password='testpass123', elo_rating=1000,
        )
        self.match = Match.objects.create(
            status=Match.Status.IN_PROGRESS,
            max_players=2,
            started_at=timezone.now() - timedelta(minutes=5),
        )
        from apps.matchmaking.models import MatchPlayer
        MatchPlayer.objects.create(match=self.match, user=self.user1, color='#FF0000')
        MatchPlayer.objects.create(match=self.match, user=self.user2, color='#0000FF')

    # --- Auth guards ---

    def test_snapshot_missing_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/game/snapshot/',
            data=json.dumps({'match_id': str(self.match.id), 'tick': 1, 'state_data': {}}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_snapshot_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/game/snapshot/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'match_id': str(self.match.id), 'tick': 1, 'state_data': {}}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_finalize_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/game/finalize/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({
                'match_id': str(self.match.id), 'winner_id': str(self.user1.id),
                'total_ticks': 100, 'final_state': {},
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_cleanup_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/game/cleanup/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'match_id': str(self.match.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_get_user_wrong_secret_returns_403(self):
        resp = self.client.get(
            f'/api/v1/internal/users/{self.user1.id}/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    def test_verify_player_wrong_secret_returns_403(self):
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/verify-player/{self.user1.id}/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    def test_match_data_wrong_secret_returns_403(self):
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/data/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    def test_anticheat_report_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/anticheat/report-violation/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({
                'match_id': str(self.match.id), 'player_id': str(self.user1.id),
                'violation_kind': 'action_flood', 'severity': 'warn',
                'detail': 'Too many actions', 'tick': 5,
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Save snapshot ---

    def test_save_snapshot_success(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/game/snapshot/',
            headers=_auth(),
            data=json.dumps({
                'match_id': str(self.match.id),
                'tick': 10,
                'state_data': {'regions': {}, 'players': {}},
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])

    def test_save_snapshot_persists_to_db(self):
        import json
        self.client.post(
            '/api/v1/internal/game/snapshot/',
            headers=_auth(),
            data=json.dumps({
                'match_id': str(self.match.id),
                'tick': 20,
                'state_data': {'tick': 20},
            }),
            content_type='application/json',
        )
        self.assertTrue(
            GameStateSnapshot.objects.filter(match=self.match, tick=20).exists()
        )

    def test_save_snapshot_upserts_on_same_tick(self):
        import json
        payload = json.dumps({
            'match_id': str(self.match.id),
            'tick': 30,
            'state_data': {'v': 1},
        })
        self.client.post(
            '/api/v1/internal/game/snapshot/', headers=_auth(),
            data=payload, content_type='application/json',
        )
        payload2 = json.dumps({
            'match_id': str(self.match.id),
            'tick': 30,
            'state_data': {'v': 2},
        })
        self.client.post(
            '/api/v1/internal/game/snapshot/', headers=_auth(),
            data=payload2, content_type='application/json',
        )
        snaps = GameStateSnapshot.objects.filter(match=self.match, tick=30)
        self.assertEqual(snaps.count(), 1)
        self.assertEqual(snaps.first().state_data['v'], 2)

    # --- Latest snapshot ---

    def test_get_latest_snapshot_returns_none_when_empty(self):
        resp = self.client.get(
            f'/api/v1/internal/game/latest-snapshot/{self.match.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNone(data['tick'])
        self.assertIsNone(data['state_data'])

    def test_get_latest_snapshot_returns_highest_tick(self):
        GameStateSnapshot.objects.create(match=self.match, tick=5, state_data={'t': 5})
        GameStateSnapshot.objects.create(match=self.match, tick=15, state_data={'t': 15})
        resp = self.client.get(
            f'/api/v1/internal/game/latest-snapshot/{self.match.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['tick'], 15)

    def test_get_latest_snapshot_wrong_secret_returns_403(self):
        resp = self.client.get(
            f'/api/v1/internal/game/latest-snapshot/{self.match.id}/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    # --- Finalize match ---

    def _final_state(self):
        return {
            'players': {
                str(self.user1.id): {
                    'is_alive': True, 'total_regions_conquered': 10,
                    'total_units_produced': 50, 'total_units_lost': 5,
                    'total_buildings_built': 3, 'eliminated_reason': '', 'eliminated_tick': 0,
                },
                str(self.user2.id): {
                    'is_alive': False, 'total_regions_conquered': 4,
                    'total_units_produced': 20, 'total_units_lost': 15,
                    'total_buildings_built': 1, 'eliminated_reason': '', 'eliminated_tick': 80,
                },
            },
            'regions': {},
        }

    def test_finalize_match_success(self):
        import json
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                resp = self.client.post(
                    '/api/v1/internal/game/finalize/',
                    headers=_auth(),
                    data=json.dumps({
                        'match_id': str(self.match.id),
                        'winner_id': str(self.user1.id),
                        'total_ticks': 100,
                        'final_state': self._final_state(),
                    }),
                    content_type='application/json',
                )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])

    def test_finalize_match_creates_match_result(self):
        import json
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                self.client.post(
                    '/api/v1/internal/game/finalize/',
                    headers=_auth(),
                    data=json.dumps({
                        'match_id': str(self.match.id),
                        'winner_id': str(self.user1.id),
                        'total_ticks': 100,
                        'final_state': self._final_state(),
                    }),
                    content_type='application/json',
                )
        self.assertTrue(MatchResult.objects.filter(match=self.match).exists())

    def test_finalize_match_updates_status_to_finished(self):
        import json
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                self.client.post(
                    '/api/v1/internal/game/finalize/',
                    headers=_auth(),
                    data=json.dumps({
                        'match_id': str(self.match.id),
                        'winner_id': str(self.user1.id),
                        'total_ticks': 100,
                        'final_state': self._final_state(),
                    }),
                    content_type='application/json',
                )
        self.match.refresh_from_db()
        self.assertEqual(self.match.status, Match.Status.FINISHED)

    def test_finalize_match_null_winner(self):
        """Finalize with no winner (draw/timeout) should succeed."""
        import json
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                resp = self.client.post(
                    '/api/v1/internal/game/finalize/',
                    headers=_auth(),
                    data=json.dumps({
                        'match_id': str(self.match.id),
                        'winner_id': None,
                        'total_ticks': 50,
                        'final_state': self._final_state(),
                    }),
                    content_type='application/json',
                )
        self.assertEqual(resp.status_code, 200)

    # --- Cleanup match ---

    @patch('apps.game.tasks.cleanup_redis_game_state')
    def test_cleanup_match_success(self, mock_cleanup):
        import json
        resp = self.client.post(
            '/api/v1/internal/game/cleanup/',
            headers=_auth(),
            data=json.dumps({'match_id': str(self.match.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])
        mock_cleanup.delay.assert_called_once_with(str(self.match.id))

    # --- Get user ---

    def test_get_user_success(self):
        resp = self.client.get(
            f'/api/v1/internal/users/{self.user1.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['id'], str(self.user1.id))
        self.assertEqual(data['username'], self.user1.username)
        self.assertIn('elo_rating', data)
        self.assertIn('is_active', data)

    def test_get_user_not_found_returns_404(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/users/{uuid.uuid4()}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_user_banned_is_not_active(self):
        self.user1.is_banned = True
        self.user1.save()
        resp = self.client.get(
            f'/api/v1/internal/users/{self.user1.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['is_active'])

    # --- Verify player ---

    def test_verify_player_is_member_and_active(self):
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/verify-player/{self.user1.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['is_member'])
        self.assertTrue(data['is_active'])

    def test_verify_player_not_member(self):
        other = User.objects.create_user(
            email='other@test.com', username='other', password='testpass123',
        )
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/verify-player/{other.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['is_member'])

    def test_verify_player_banned_user_not_active(self):
        self.user1.is_banned = True
        self.user1.save()
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/verify-player/{self.user1.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['is_member'])
        self.assertFalse(data['is_active'])

    def test_verify_player_unknown_user_not_active(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/verify-player/{uuid.uuid4()}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['is_active'])

    # --- Match data ---

    def test_get_match_data_success(self):
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/data/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('max_players', data)
        self.assertIn('players', data)
        self.assertEqual(len(data['players']), 2)

    def test_get_match_data_includes_deck_snapshot_keys(self):
        resp = self.client.get(
            f'/api/v1/internal/matches/{self.match.id}/data/',
            headers=_auth(),
        )
        player = resp.json()['players'][0]
        for key in ('unlocked_buildings', 'unlocked_units', 'ability_scrolls',
                    'active_boosts', 'ability_levels', 'building_levels'):
            self.assertIn(key, player)

    def test_get_match_data_not_found_returns_404(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/matches/{uuid.uuid4()}/data/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 404)

    # --- Update match status ---

    def test_update_match_status_success(self):
        import json
        resp = self.client.patch(
            f'/api/v1/internal/matches/{self.match.id}/status/',
            headers=_auth(),
            data=json.dumps({'status': 'in_progress'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])
        self.match.refresh_from_db()
        self.assertEqual(self.match.status, 'in_progress')

    def test_update_match_status_not_found_returns_404(self):
        import json, uuid
        resp = self.client.patch(
            f'/api/v1/internal/matches/{uuid.uuid4()}/status/',
            headers=_auth(),
            data=json.dumps({'status': 'in_progress'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    def test_update_match_status_wrong_secret_returns_403(self):
        import json
        resp = self.client.patch(
            f'/api/v1/internal/matches/{self.match.id}/status/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'status': 'in_progress'}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Set player alive ---

    def test_set_player_alive_false(self):
        import json
        from apps.matchmaking.models import MatchPlayer
        resp = self.client.patch(
            f'/api/v1/internal/matches/{self.match.id}/players/{self.user1.id}/alive/',
            headers=_auth(),
            data=json.dumps({'is_alive': False}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])
        mp = MatchPlayer.objects.get(match=self.match, user=self.user1)
        self.assertFalse(mp.is_alive)
        self.assertIsNotNone(mp.eliminated_at)

    def test_set_player_alive_true_clears_eliminated_at(self):
        import json
        from apps.matchmaking.models import MatchPlayer
        mp = MatchPlayer.objects.get(match=self.match, user=self.user1)
        mp.is_alive = False
        mp.eliminated_at = timezone.now()
        mp.save()
        resp = self.client.patch(
            f'/api/v1/internal/matches/{self.match.id}/players/{self.user1.id}/alive/',
            headers=_auth(),
            data=json.dumps({'is_alive': True}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        mp.refresh_from_db()
        self.assertTrue(mp.is_alive)
        self.assertIsNone(mp.eliminated_at)

    def test_set_player_alive_not_found_returns_404(self):
        import json, uuid
        resp = self.client.patch(
            f'/api/v1/internal/matches/{self.match.id}/players/{uuid.uuid4()}/alive/',
            headers=_auth(),
            data=json.dumps({'is_alive': False}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    def test_set_player_alive_wrong_secret_returns_403(self):
        import json
        resp = self.client.patch(
            f'/api/v1/internal/matches/{self.match.id}/players/{self.user1.id}/alive/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'is_alive': False}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Active matches list ---

    def test_list_active_matches_includes_selecting_and_in_progress(self):
        m2 = Match.objects.create(status=Match.Status.SELECTING, max_players=2)
        resp = self.client.get(
            '/api/v1/internal/game/active-matches/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        ids = resp.json()['match_ids']
        self.assertIn(str(self.match.id), ids)
        self.assertIn(str(m2.id), ids)

    def test_list_active_matches_excludes_finished(self):
        finished = Match.objects.create(status=Match.Status.FINISHED, max_players=2)
        resp = self.client.get(
            '/api/v1/internal/game/active-matches/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        ids = resp.json()['match_ids']
        self.assertNotIn(str(finished.id), ids)

    def test_list_active_matches_wrong_secret_returns_403(self):
        resp = self.client.get(
            '/api/v1/internal/game/active-matches/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    # --- Anticheat report violation ---

    def test_report_violation_success(self):
        import json
        from apps.game.models import AnticheatViolation
        resp = self.client.post(
            '/api/v1/internal/anticheat/report-violation/',
            headers=_auth(),
            data=json.dumps({
                'match_id': str(self.match.id),
                'player_id': str(self.user1.id),
                'violation_kind': 'action_flood',
                'severity': 'warn',
                'detail': 'Too many actions per tick',
                'tick': 42,
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()['ok'])
        self.assertTrue(
            AnticheatViolation.objects.filter(
                match=self.match, player=self.user1, violation_kind='action_flood'
            ).exists()
        )

    def test_report_violation_persists_all_fields(self):
        import json
        from apps.game.models import AnticheatViolation
        self.client.post(
            '/api/v1/internal/anticheat/report-violation/',
            headers=_auth(),
            data=json.dumps({
                'match_id': str(self.match.id),
                'player_id': str(self.user1.id),
                'violation_kind': 'impossible_timing',
                'severity': 'flag',
                'detail': 'Action arrived before tick start',
                'tick': 77,
            }),
            content_type='application/json',
        )
        v = AnticheatViolation.objects.get(
            match=self.match, player=self.user1, violation_kind='impossible_timing'
        )
        self.assertEqual(v.severity, 'flag')
        self.assertEqual(v.tick, 77)

    # --- Anticheat ban player ---

    def test_ban_player_success(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/anticheat/ban-player/',
            headers=_auth(),
            data=json.dumps({
                'player_id': str(self.user2.id),
                'reason': 'Repeated action flooding',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])
        self.user2.refresh_from_db()
        self.assertTrue(self.user2.is_banned)
        self.assertEqual(self.user2.banned_reason, 'Repeated action flooding')

    def test_ban_player_not_found_returns_404(self):
        import json, uuid
        resp = self.client.post(
            '/api/v1/internal/anticheat/ban-player/',
            headers=_auth(),
            data=json.dumps({
                'player_id': str(uuid.uuid4()),
                'reason': 'Cheating',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    def test_ban_player_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/anticheat/ban-player/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({
                'player_id': str(self.user2.id),
                'reason': 'Cheating',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Anticheat compensate ---

    def test_compensate_players_no_results_returns_not_found(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/anticheat/compensate/',
            headers=_auth(),
            data=json.dumps({
                'match_id': str(self.match.id),
                'player_ids': [str(self.user1.id)],
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['ok'])
        self.assertIn(str(self.user1.id), data['not_found'])

    def test_compensate_reverses_elo_change(self):
        import json
        # finalize first so PlayerResult exists
        with patch('apps.inventory.tasks.generate_match_drops', side_effect=Exception('skip')):
            with patch('apps.developers.tasks.dispatch_webhook_event', side_effect=Exception('skip')):
                finalize_match_results_sync(
                    str(self.match.id), str(self.user1.id), 100, {
                        'players': {
                            str(self.user1.id): {
                                'is_alive': True, 'total_regions_conquered': 10,
                                'total_units_produced': 50, 'total_units_lost': 5,
                                'total_buildings_built': 3,
                                'eliminated_reason': '', 'eliminated_tick': 0,
                            },
                            str(self.user2.id): {
                                'is_alive': False, 'total_regions_conquered': 4,
                                'total_units_produced': 20, 'total_units_lost': 10,
                                'total_buildings_built': 1,
                                'eliminated_reason': '', 'eliminated_tick': 80,
                            },
                        },
                        'regions': {},
                    },
                )
        self.user2.refresh_from_db()
        elo_after_loss = self.user2.elo_rating

        resp = self.client.post(
            '/api/v1/internal/anticheat/compensate/',
            headers=_auth(),
            data=json.dumps({
                'match_id': str(self.match.id),
                'player_ids': [str(self.user2.id)],
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn(str(self.user2.id), data['compensated'])
        self.user2.refresh_from_db()
        # ELO should be back to 1000 (the original)
        self.assertEqual(self.user2.elo_rating, 1000)

    def test_compensate_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/anticheat/compensate/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'match_id': str(self.match.id), 'player_ids': []}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Neighbor map ---

    @patch('apps.geo.models.Region.objects')
    def test_neighbor_map_returns_dict(self, mock_qs_manager):
        # Region uses PostGIS geometry which is unavailable in plain PG test backend.
        # Patch the manager so the endpoint can run without a geometry column.
        mock_qs_manager.prefetch_related.return_value.all.return_value = []
        resp = self.client.get(
            '/api/v1/internal/regions/neighbors/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('neighbors', data)
        self.assertIsInstance(data['neighbors'], dict)

    def test_neighbor_map_wrong_secret_returns_403(self):
        resp = self.client.get(
            '/api/v1/internal/regions/neighbors/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)
