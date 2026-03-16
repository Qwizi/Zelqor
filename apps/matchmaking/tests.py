"""
Tests for apps/matchmaking — Match, MatchPlayer, MatchQueue models.
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.matchmaking.models import Match, MatchPlayer, MatchQueue
from apps.game_config.models import GameSettings

User = get_user_model()


# ---------------------------------------------------------------------------
# Match model
# ---------------------------------------------------------------------------

class MatchModelTests(TestCase):
    """Tests for the Match model."""

    def test_default_status_is_waiting(self):
        match = Match.objects.create(max_players=2)
        self.assertEqual(match.status, Match.Status.WAITING)

    def test_str_representation_includes_status(self):
        match = Match.objects.create(max_players=2, status=Match.Status.IN_PROGRESS)
        self.assertIn('In Progress', str(match))
        self.assertIn(str(match.id), str(match))

    def test_status_transitions_selecting(self):
        match = Match.objects.create(max_players=2)
        match.status = Match.Status.SELECTING
        match.save()
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.SELECTING)

    def test_status_transitions_in_progress(self):
        match = Match.objects.create(max_players=2)
        match.status = Match.Status.IN_PROGRESS
        match.started_at = timezone.now()
        match.save()
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.IN_PROGRESS)
        self.assertIsNotNone(match.started_at)

    def test_status_transitions_finished(self):
        match = Match.objects.create(max_players=2, status=Match.Status.IN_PROGRESS)
        match.status = Match.Status.FINISHED
        match.finished_at = timezone.now()
        match.save()
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.FINISHED)

    def test_status_transitions_cancelled(self):
        match = Match.objects.create(max_players=2)
        match.status = Match.Status.CANCELLED
        match.save()
        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.CANCELLED)

    def test_winner_field_nullable(self):
        match = Match.objects.create(max_players=2)
        self.assertIsNone(match.winner)

    def test_settings_snapshot_default_is_empty_dict(self):
        match = Match.objects.create(max_players=2)
        self.assertEqual(match.settings_snapshot, {})

    def test_is_tutorial_default_false(self):
        match = Match.objects.create(max_players=2)
        self.assertFalse(match.is_tutorial)

    def test_tutorial_match_creation(self):
        match = Match.objects.create(max_players=1, is_tutorial=True)
        self.assertTrue(match.is_tutorial)

    def test_ordering_newest_first(self):
        m1 = Match.objects.create(max_players=2)
        m2 = Match.objects.create(max_players=2)
        matches = list(Match.objects.all())
        # Newest first
        self.assertEqual(matches[0].pk, m2.pk)

    def test_all_status_choices_valid(self):
        valid_statuses = [
            Match.Status.WAITING,
            Match.Status.SELECTING,
            Match.Status.IN_PROGRESS,
            Match.Status.FINISHED,
            Match.Status.CANCELLED,
        ]
        for status in valid_statuses:
            match = Match.objects.create(max_players=2, status=status)
            match.refresh_from_db()
            self.assertEqual(match.status, status)


# ---------------------------------------------------------------------------
# MatchPlayer model
# ---------------------------------------------------------------------------

class MatchPlayerModelTests(TestCase):
    """Tests for the MatchPlayer model."""

    def setUp(self):
        self.user1 = User.objects.create_user(
            email='mp1@test.com', username='mpplayer1', password='testpass123',
        )
        self.user2 = User.objects.create_user(
            email='mp2@test.com', username='mpplayer2', password='testpass123',
        )
        self.match = Match.objects.create(max_players=2)

    def test_creation_and_relationships(self):
        mp = MatchPlayer.objects.create(match=self.match, user=self.user1, color='#FF0000')
        self.assertEqual(mp.match, self.match)
        self.assertEqual(mp.user, self.user1)
        self.assertEqual(mp.color, '#FF0000')

    def test_default_is_alive_true(self):
        mp = MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertTrue(mp.is_alive)

    def test_str_representation(self):
        mp = MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertIn('mpplayer1', str(mp))

    def test_unique_together_match_user(self):
        MatchPlayer.objects.create(match=self.match, user=self.user1)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            MatchPlayer.objects.create(match=self.match, user=self.user1)

    def test_multiple_players_in_same_match(self):
        MatchPlayer.objects.create(match=self.match, user=self.user1, color='#FF0000')
        MatchPlayer.objects.create(match=self.match, user=self.user2, color='#0000FF')
        self.assertEqual(self.match.players.count(), 2)

    def test_eliminated_at_null_by_default(self):
        mp = MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertIsNone(mp.eliminated_at)

    def test_deck_snapshot_default_empty_dict(self):
        mp = MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertEqual(mp.deck_snapshot, {})

    def test_cosmetic_snapshot_default_empty_dict(self):
        mp = MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertEqual(mp.cosmetic_snapshot, {})

    def test_player_related_name_on_match(self):
        MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertEqual(self.match.players.count(), 1)

    def test_match_related_name_on_user(self):
        MatchPlayer.objects.create(match=self.match, user=self.user1)
        self.assertEqual(self.user1.match_players.count(), 1)


# ---------------------------------------------------------------------------
# MatchQueue model
# ---------------------------------------------------------------------------

class MatchQueueTests(TestCase):
    """Tests for the MatchQueue model."""

    def setUp(self):
        self.user = User.objects.create_user(
            email='queue@test.com', username='queueuser', password='testpass123',
        )

    def test_queue_creation(self):
        entry = MatchQueue.objects.create(user=self.user)
        self.assertEqual(entry.user, self.user)

    def test_str_representation(self):
        entry = MatchQueue.objects.create(user=self.user)
        self.assertIn('queueuser', str(entry))

    def test_one_entry_per_user(self):
        MatchQueue.objects.create(user=self.user)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            MatchQueue.objects.create(user=self.user)

    def test_joined_at_auto_set(self):
        entry = MatchQueue.objects.create(user=self.user)
        self.assertIsNotNone(entry.joined_at)


# ---------------------------------------------------------------------------
# Internal API — auth guard helpers
# ---------------------------------------------------------------------------

INTERNAL_SECRET = 'test-internal-secret'
WRONG_SECRET = 'wrong-secret'


def _auth(headers=None):
    """Return headers dict with the correct X-Internal-Secret."""
    h = {'X-Internal-Secret': INTERNAL_SECRET}
    if headers:
        h.update(headers)
    return h


# ---------------------------------------------------------------------------
# MatchmakingInternalAPITests
# ---------------------------------------------------------------------------

class MatchmakingInternalAPITests(TestCase):
    """Tests for the MatchmakingInternalController endpoints."""

    def setUp(self):
        from apps.game_config.models import GameSettings
        GameSettings.get()  # ensure singleton
        self.user1 = User.objects.create_user(
            email='iapi1@test.com', username='iapi_player1', password='testpass123',
        )
        self.user2 = User.objects.create_user(
            email='iapi2@test.com', username='iapi_player2', password='testpass123',
        )
        self.match = Match.objects.create(
            status=Match.Status.SELECTING,
            max_players=2,
        )
        MatchPlayer.objects.create(match=self.match, user=self.user1, color='#FF0000')
        MatchPlayer.objects.create(match=self.match, user=self.user2, color='#0000FF')

    # --- Auth guard ---

    def test_queue_add_missing_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            data=json.dumps({'user_id': str(self.user1.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_queue_add_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'user_id': str(self.user1.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_queue_remove_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/remove/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'user_id': str(self.user1.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_queue_count_wrong_secret_returns_403(self):
        resp = self.client.get(
            '/api/v1/internal/matchmaking/queue/count/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    def test_active_match_wrong_secret_returns_403(self):
        resp = self.client.get(
            f'/api/v1/internal/matchmaking/active-match/{self.user1.id}/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    def test_try_match_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/matchmaking/try-match/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Queue add ---

    def test_queue_add_success(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.user1.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['ok'])

    def test_queue_add_creates_queue_entry(self):
        import json
        self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.user1.id)}),
            content_type='application/json',
        )
        self.assertTrue(MatchQueue.objects.filter(user=self.user1).exists())

    def test_queue_add_unknown_user_returns_404(self):
        import json
        import uuid
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            headers=_auth(),
            data=json.dumps({'user_id': str(uuid.uuid4())}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    def test_queue_add_idempotent(self):
        """Adding the same user twice should upsert, not raise."""
        import json
        payload = json.dumps({'user_id': str(self.user1.id)})
        self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            headers=_auth(), data=payload, content_type='application/json',
        )
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/add/',
            headers=_auth(), data=payload, content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(MatchQueue.objects.filter(user=self.user1).count(), 1)

    # --- Queue remove ---

    def test_queue_remove_success(self):
        import json
        MatchQueue.objects.create(user=self.user1)
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/remove/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.user1.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(MatchQueue.objects.filter(user=self.user1).exists())

    def test_queue_remove_nonexistent_user_still_200(self):
        """Remove is idempotent — user not in queue should still return ok."""
        import json
        import uuid
        resp = self.client.post(
            '/api/v1/internal/matchmaking/queue/remove/',
            headers=_auth(),
            data=json.dumps({'user_id': str(uuid.uuid4())}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)

    # --- Queue count ---

    def test_queue_count_returns_correct_number(self):
        MatchQueue.objects.create(user=self.user1)
        MatchQueue.objects.create(user=self.user2)
        resp = self.client.get(
            '/api/v1/internal/matchmaking/queue/count/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertGreaterEqual(data['count'], 2)

    def test_queue_count_empty_queue(self):
        MatchQueue.objects.all().delete()
        resp = self.client.get(
            '/api/v1/internal/matchmaking/queue/count/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 0)

    # --- Active match ---

    def test_get_active_match_found(self):
        resp = self.client.get(
            f'/api/v1/internal/matchmaking/active-match/{self.user1.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['match_id'], str(self.match.id))

    def test_get_active_match_none_when_no_active(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/matchmaking/active-match/{uuid.uuid4()}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['match_id'])

    def test_get_active_match_none_when_finished(self):
        """Finished matches should not count as active."""
        self.match.status = Match.Status.FINISHED
        self.match.save()
        resp = self.client.get(
            f'/api/v1/internal/matchmaking/active-match/{self.user1.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['match_id'])

    # --- Try match ---

    def test_try_match_not_enough_players_returns_null(self):
        import json
        MatchQueue.objects.all().delete()
        resp = self.client.post(
            '/api/v1/internal/matchmaking/try-match/',
            headers=_auth(),
            data=json.dumps({}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['match_id'])

    def test_try_match_creates_match_when_enough_players(self):
        import json
        from apps.game_config.models import GameSettings
        GameSettings.get()
        MatchQueue.objects.all().delete()
        MatchQueue.objects.create(user=self.user1)
        MatchQueue.objects.create(user=self.user2)
        resp = self.client.post(
            '/api/v1/internal/matchmaking/try-match/',
            headers=_auth(),
            data=json.dumps({}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNotNone(data['match_id'])
        self.assertIn(str(self.user1.id), data['user_ids'])
        self.assertIn(str(self.user2.id), data['user_ids'])

    def test_try_match_removes_players_from_queue(self):
        import json
        from apps.game_config.models import GameSettings
        GameSettings.get()
        MatchQueue.objects.all().delete()
        MatchQueue.objects.create(user=self.user1)
        MatchQueue.objects.create(user=self.user2)
        self.client.post(
            '/api/v1/internal/matchmaking/try-match/',
            headers=_auth(),
            data=json.dumps({}),
            content_type='application/json',
        )
        self.assertFalse(MatchQueue.objects.filter(user=self.user1).exists())
        self.assertFalse(MatchQueue.objects.filter(user=self.user2).exists())


# ---------------------------------------------------------------------------
# LobbyInternalAPITests
# ---------------------------------------------------------------------------

class LobbyInternalAPITests(TestCase):
    """Tests for the LobbyInternalController endpoints."""

    def setUp(self):
        from apps.game_config.models import GameSettings
        GameSettings.get()
        self.host = User.objects.create_user(
            email='lobbyhost@test.com', username='lobbyhost', password='testpass123',
        )
        self.guest = User.objects.create_user(
            email='lobbyguest@test.com', username='lobbyguest', password='testpass123',
        )

    def _create_lobby(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/lobby/create/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.host.id)}),
            content_type='application/json',
        )
        return resp

    # --- Auth guard ---

    def test_create_lobby_wrong_secret_returns_403(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/lobby/create/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'user_id': str(self.host.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_join_lobby_wrong_secret_returns_403(self):
        import json
        import uuid
        resp = self.client.post(
            '/api/v1/internal/lobby/join/',
            headers={'X-Internal-Secret': WRONG_SECRET},
            data=json.dumps({'lobby_id': str(uuid.uuid4()), 'user_id': str(self.guest.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    # --- Create lobby ---

    def test_create_lobby_success(self):
        resp = self._create_lobby()
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('lobby_id', data)
        self.assertEqual(len(data['players']), 1)
        self.assertEqual(data['players'][0]['user_id'], str(self.host.id))

    def test_create_lobby_unknown_user_returns_404(self):
        import json, uuid
        resp = self.client.post(
            '/api/v1/internal/lobby/create/',
            headers=_auth(),
            data=json.dumps({'user_id': str(uuid.uuid4())}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    # --- Join lobby ---

    def test_join_lobby_success(self):
        import json
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        resp = self.client.post(
            '/api/v1/internal/lobby/join/',
            headers=_auth(),
            data=json.dumps({'lobby_id': lobby_id, 'user_id': str(self.guest.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        user_ids = [p['user_id'] for p in data['players']]
        self.assertIn(str(self.guest.id), user_ids)

    def test_join_lobby_nonexistent_lobby_returns_404(self):
        import json, uuid
        resp = self.client.post(
            '/api/v1/internal/lobby/join/',
            headers=_auth(),
            data=json.dumps({'lobby_id': str(uuid.uuid4()), 'user_id': str(self.guest.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    # --- Leave lobby ---

    def test_leave_lobby_host_cancels_lobby(self):
        import json
        from apps.matchmaking.models import Lobby
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        resp = self.client.post(
            '/api/v1/internal/lobby/leave/',
            headers=_auth(),
            data=json.dumps({'lobby_id': lobby_id, 'user_id': str(self.host.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['cancelled'])
        lobby = Lobby.objects.get(id=lobby_id)
        self.assertEqual(lobby.status, Lobby.Status.CANCELLED)

    def test_leave_lobby_nonexistent_returns_404(self):
        import json, uuid
        resp = self.client.post(
            '/api/v1/internal/lobby/leave/',
            headers=_auth(),
            data=json.dumps({'lobby_id': str(uuid.uuid4()), 'user_id': str(self.host.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    # --- Get lobby ---

    def test_get_lobby_success(self):
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        resp = self.client.get(
            f'/api/v1/internal/lobby/get/{lobby_id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['lobby_id'], lobby_id)
        self.assertEqual(data['host_user_id'], str(self.host.id))

    def test_get_lobby_nonexistent_returns_404(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/lobby/get/{uuid.uuid4()}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_lobby_wrong_secret_returns_403(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/lobby/get/{uuid.uuid4()}/',
            headers={'X-Internal-Secret': WRONG_SECRET},
        )
        self.assertEqual(resp.status_code, 403)

    # --- Active lobby ---

    def test_get_active_lobby_found(self):
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        resp = self.client.get(
            f'/api/v1/internal/lobby/active/{self.host.id}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['lobby_id'], lobby_id)

    def test_get_active_lobby_none_when_not_in_lobby(self):
        import uuid
        resp = self.client.get(
            f'/api/v1/internal/lobby/active/{uuid.uuid4()}/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['lobby_id'])

    # --- Set ready ---

    def test_set_ready_success(self):
        import json
        from apps.matchmaking.models import Lobby, LobbyPlayer
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        # join second player to fill lobby (max_players=2 from GameSettings default)
        self.client.post(
            '/api/v1/internal/lobby/join/',
            headers=_auth(),
            data=json.dumps({'lobby_id': lobby_id, 'user_id': str(self.guest.id)}),
            content_type='application/json',
        )
        resp = self.client.post(
            '/api/v1/internal/lobby/set-ready/',
            headers=_auth(),
            data=json.dumps({'lobby_id': lobby_id, 'user_id': str(self.host.id), 'is_ready': True}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        lp = LobbyPlayer.objects.get(lobby_id=lobby_id, user=self.host)
        self.assertTrue(lp.is_ready)

    def test_set_ready_player_not_in_lobby_returns_404(self):
        import json, uuid
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        resp = self.client.post(
            '/api/v1/internal/lobby/set-ready/',
            headers=_auth(),
            data=json.dumps({'lobby_id': lobby_id, 'user_id': str(uuid.uuid4()), 'is_ready': True}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 404)

    # --- Find waiting lobby ---

    def test_find_waiting_lobby_returns_none_when_empty(self):
        resp = self.client.get(
            '/api/v1/internal/lobby/find-waiting/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['lobby_id'])

    def test_find_waiting_lobby_returns_lobby(self):
        create_resp = self._create_lobby()
        lobby_id = create_resp.json()['lobby_id']
        resp = self.client.get(
            '/api/v1/internal/lobby/find-waiting/',
            headers=_auth(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['lobby_id'], lobby_id)

    # --- Find or create ---

    def test_find_or_create_creates_new_lobby_when_none_waiting(self):
        import json
        resp = self.client.post(
            '/api/v1/internal/lobby/find-or-create/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.host.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('lobby_id', data)
        self.assertTrue(data['created'])

    def test_find_or_create_joins_existing_lobby(self):
        import json
        # host creates
        self.client.post(
            '/api/v1/internal/lobby/find-or-create/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.host.id)}),
            content_type='application/json',
        )
        # guest joins existing
        resp = self.client.post(
            '/api/v1/internal/lobby/find-or-create/',
            headers=_auth(),
            data=json.dumps({'user_id': str(self.guest.id)}),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertFalse(data['created'])


# ---------------------------------------------------------------------------
# DeckConsumptionTests — _consume_default_deck helper
# ---------------------------------------------------------------------------

class DeckConsumptionTests(TestCase):
    """Tests for the _consume_default_deck helper."""

    def setUp(self):
        self.user = User.objects.create_user(
            email='deckuser@test.com', username='deckuser', password='testpass123',
        )

    def test_no_deck_returns_free_ability(self):
        from apps.matchmaking.internal_api import _consume_default_deck
        result = _consume_default_deck(self.user)
        self.assertIn('ab_shield', result['ability_scrolls'])
        self.assertEqual(result['ability_scrolls']['ab_shield'], 999)

    def test_no_deck_returns_empty_buildings(self):
        from apps.matchmaking.internal_api import _consume_default_deck
        result = _consume_default_deck(self.user)
        self.assertEqual(result['unlocked_buildings'], [])

    def test_no_deck_returns_empty_units(self):
        from apps.matchmaking.internal_api import _consume_default_deck
        result = _consume_default_deck(self.user)
        self.assertEqual(result['unlocked_units'], [])

    def test_no_deck_returns_empty_boosts(self):
        from apps.matchmaking.internal_api import _consume_default_deck
        result = _consume_default_deck(self.user)
        self.assertEqual(result['active_boosts'], [])

    def test_no_deck_returns_all_required_keys(self):
        from apps.matchmaking.internal_api import _consume_default_deck
        result = _consume_default_deck(self.user)
        for key in ('unlocked_buildings', 'building_levels', 'unlocked_units',
                    'ability_scrolls', 'ability_levels', 'active_boosts', 'instance_ids'):
            self.assertIn(key, result)

    def test_ab_shield_level_is_1(self):
        from apps.matchmaking.internal_api import _consume_default_deck
        result = _consume_default_deck(self.user)
        self.assertEqual(result['ability_levels']['ab_shield'], 1)
