"""
Integration / E2E tests for the MapLord Django backend.

Run with:
    uv run python manage.py test tests.test_integration --settings=config.test_settings -v2

These tests exercise full API flows via Django's test client.  They hit the
real database (a fresh test_maplord DB is created and destroyed per test run)
and verify end-to-end request → model → response behaviour.

Notes:
- JWT tokens are decoded from login responses and passed in Authorization headers.
- Internal API calls use the X-Internal-Secret header.
- The ws_ticket endpoint connects to Redis.  Tests that call it are skipped when
  Redis is unavailable (SKIP_REDIS_TESTS env-var or import failure).
- GameMode / TutorialBot fixtures are created per-test where required.
"""

import json
import uuid
import os

from django.contrib.auth import get_user_model
from django.conf import settings
from django.test import TestCase, Client
from django.utils import timezone

User = get_user_model()

INTERNAL_SECRET = getattr(settings, 'INTERNAL_SECRET', 'test-internal-secret')

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(client, url, payload, headers=None):
    kwargs = {'content_type': 'application/json'}
    if headers:
        kwargs.update(headers)
    return client.post(url, data=json.dumps(payload), **kwargs)


def _get_json(client, url, headers=None):
    kwargs = {}
    if headers:
        kwargs.update(headers)
    return client.get(url, **kwargs)


def _patch_json(client, url, payload, headers=None):
    kwargs = {'content_type': 'application/json'}
    if headers:
        kwargs.update(headers)
    return client.patch(url, data=json.dumps(payload), **kwargs)


def _auth_header(token):
    return {'HTTP_AUTHORIZATION': f'Bearer {token}'}


def _internal_header():
    return {'HTTP_X_INTERNAL_SECRET': INTERNAL_SECRET}


def _login(client, email, password):
    """Login and return the access token string."""
    resp = _post_json(client, '/api/v1/token/pair', {'email': email, 'password': password})
    assert resp.status_code == 200, f"Login failed ({resp.status_code}): {resp.content}"
    return resp.json()['access']


def _register_and_login(client, email, username, password):
    """Register a new user via the API and log in, returning (user_id, access_token)."""
    reg_resp = _post_json(client, '/api/v1/auth/register', {
        'email': email,
        'username': username,
        'password': password,
    })
    assert reg_resp.status_code == 200, f"Register failed ({reg_resp.status_code}): {reg_resp.content}"
    user_id = reg_resp.json()['id']
    token = _login(client, email, password)
    return user_id, token


def _make_game_mode(slug='standard', name='Standard', is_default=True, is_active=True):
    """Create a minimal GameMode fixture in the database."""
    from apps.game_config.models import GameMode
    return GameMode.objects.create(
        name=name,
        slug=slug,
        description='Test mode',
        max_players=2,
        min_players=2,
        is_default=is_default,
        is_active=is_active,
    )


def _make_tutorial_bot():
    """Create the TutorialBot user required by the tutorial endpoint."""
    return User.objects.get_or_create(
        username='TutorialBot',
        defaults={
            'email': 'tutorialbot@internal.maplord',
            'is_bot': True,
        },
    )[0]


def _create_match_via_internal(client, user1_id, user2_id, game_mode=None):
    """Add two users to the queue then call try-match.  Returns match_id string."""
    add1 = _post_json(client, '/api/v1/internal/matchmaking/queue/add/', {
        'user_id': str(user1_id),
        'game_mode': game_mode,
    }, headers=_internal_header())
    assert add1.status_code == 200, f"queue/add user1 failed: {add1.content}"

    add2 = _post_json(client, '/api/v1/internal/matchmaking/queue/add/', {
        'user_id': str(user2_id),
        'game_mode': game_mode,
    }, headers=_internal_header())
    assert add2.status_code == 200, f"queue/add user2 failed: {add2.content}"

    match_resp = _post_json(client, '/api/v1/internal/matchmaking/try-match/', {
        'game_mode': game_mode,
    }, headers=_internal_header())
    assert match_resp.status_code == 200, f"try-match failed: {match_resp.content}"
    match_id = match_resp.json().get('match_id')
    assert match_id is not None, "try-match returned null match_id"
    return match_id


# ---------------------------------------------------------------------------
# AuthFlowIntegrationTests
# ---------------------------------------------------------------------------

class AuthFlowIntegrationTests(TestCase):

    def setUp(self):
        self.client = Client()

    def test_register_then_login_flow(self):
        """Register → login → GET /auth/me → verify data consistency."""
        email = 'authflow@test.com'
        username = 'authflowuser'
        password = 'securepass123'

        reg_resp = _post_json(self.client, '/api/v1/auth/register', {
            'email': email, 'username': username, 'password': password,
        })
        self.assertEqual(reg_resp.status_code, 200)
        reg_data = reg_resp.json()
        self.assertEqual(reg_data['email'], email)
        self.assertEqual(reg_data['username'], username)

        token = _login(self.client, email, password)

        me_resp = _get_json(self.client, '/api/v1/auth/me', headers=_auth_header(token))
        self.assertEqual(me_resp.status_code, 200)
        me_data = me_resp.json()
        self.assertEqual(me_data['email'], email)
        self.assertEqual(me_data['username'], username)
        self.assertEqual(me_data['id'], reg_data['id'])

    def test_login_returns_valid_jwt(self):
        """Login response contains access and refresh tokens with correct user_id claim."""
        import base64

        User.objects.create_user(email='jwttest@test.com', username='jwttest', password='securepass123')
        resp = _post_json(self.client, '/api/v1/token/pair', {
            'email': 'jwttest@test.com', 'password': 'securepass123',
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('access', data)
        self.assertIn('refresh', data)

        # Decode payload (no signature verification needed — just inspect claims)
        payload_b64 = data['access'].split('.')[1]
        # Add padding if needed
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += '=' * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        self.assertIn('user_id', payload)
        user = User.objects.get(email='jwttest@test.com')
        self.assertEqual(payload['user_id'], str(user.id))

    def test_refresh_token_returns_new_access(self):
        """Use refresh token to obtain a new access token."""
        User.objects.create_user(email='refresh@test.com', username='refreshuser', password='securepass123')
        pair_resp = _post_json(self.client, '/api/v1/token/pair', {
            'email': 'refresh@test.com', 'password': 'securepass123',
        })
        self.assertEqual(pair_resp.status_code, 200)
        refresh_token = pair_resp.json()['refresh']
        original_access = pair_resp.json()['access']

        refresh_resp = _post_json(self.client, '/api/v1/token/refresh', {'refresh': refresh_token})
        self.assertEqual(refresh_resp.status_code, 200)
        new_access = refresh_resp.json().get('access')
        self.assertIsNotNone(new_access)
        # A new token must be a valid non-empty string (content may differ from original)
        self.assertTrue(len(new_access) > 10)

    def test_register_duplicate_email_fails(self):
        """Registering twice with the same email returns 400."""
        payload = {'email': 'dup@test.com', 'username': 'dupuser1', 'password': 'securepass123'}
        resp1 = _post_json(self.client, '/api/v1/auth/register', payload)
        self.assertEqual(resp1.status_code, 200)

        payload2 = {'email': 'dup@test.com', 'username': 'dupuser2', 'password': 'securepass123'}
        resp2 = _post_json(self.client, '/api/v1/auth/register', payload2)
        self.assertEqual(resp2.status_code, 400)

    def test_register_duplicate_username_fails(self):
        """Registering twice with the same username returns 400."""
        _post_json(self.client, '/api/v1/auth/register', {
            'email': 'user1@test.com', 'username': 'sharedname', 'password': 'securepass123',
        })
        resp = _post_json(self.client, '/api/v1/auth/register', {
            'email': 'user2@test.com', 'username': 'sharedname', 'password': 'securepass123',
        })
        self.assertEqual(resp.status_code, 400)

    def test_ws_ticket_returns_challenge(self):
        """Authenticated POST /auth/ws-ticket/ returns ticket, challenge, difficulty."""
        try:
            import redis as redis_lib
            r = redis_lib.Redis(
                host=getattr(settings, 'REDIS_HOST', 'localhost'),
                port=getattr(settings, 'REDIS_PORT', 6379),
                db=getattr(settings, 'REDIS_GAME_DB', 1),
            )
            r.ping()
        except Exception:
            self.skipTest("Redis not available — skipping ws_ticket test")

        User.objects.create_user(email='wsticket@test.com', username='wsticket', password='securepass123')
        token = _login(self.client, 'wsticket@test.com', 'securepass123')
        resp = _post_json(self.client, '/api/v1/auth/ws-ticket/', {}, headers=_auth_header(token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('ticket', data)
        self.assertIn('challenge', data)
        self.assertIn('difficulty', data)
        self.assertIsInstance(data['difficulty'], int)
        self.assertTrue(len(data['ticket']) > 10)

    def test_unauthenticated_me_returns_401(self):
        """GET /auth/me without a token returns 401."""
        resp = self.client.get('/api/v1/auth/me')
        self.assertEqual(resp.status_code, 401)


# ---------------------------------------------------------------------------
# ConfigIntegrationTests
# ---------------------------------------------------------------------------

class ConfigIntegrationTests(TestCase):

    def setUp(self):
        self.client = Client()

    def test_config_returns_full_game_data(self):
        """GET /config/ returns all top-level config keys."""
        resp = self.client.get('/api/v1/config/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        for key in ('settings', 'buildings', 'units', 'abilities', 'maps', 'game_modes'):
            self.assertIn(key, data, f"Missing key '{key}' in config response")

    def test_config_settings_has_expected_fields(self):
        """The settings sub-object contains timing and combat fields."""
        resp = self.client.get('/api/v1/config/')
        self.assertEqual(resp.status_code, 200)
        s = resp.json()['settings']
        for field in ('max_players', 'tick_interval_ms', 'starting_units', 'starting_energy'):
            self.assertIn(field, s, f"Missing settings field: {field}")

    def test_game_modes_list(self):
        """GET /config/game-modes/ returns a list."""
        _make_game_mode()
        resp = self.client.get('/api/v1/config/game-modes/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

    def test_game_modes_list_items_have_expected_fields(self):
        """Each item in the game-modes list has required schema fields."""
        _make_game_mode(slug='standard2', name='Standard2')
        resp = self.client.get('/api/v1/config/game-modes/')
        self.assertEqual(resp.status_code, 200)
        item = resp.json()[0]
        for field in ('id', 'name', 'slug', 'max_players', 'min_players', 'is_default'):
            self.assertIn(field, item, f"Missing game mode field: {field}")

    def test_game_mode_detail(self):
        """GET /config/game-modes/{slug}/ returns the correct mode with full fields."""
        _make_game_mode(slug='detail-mode', name='Detail Mode', is_default=False)
        resp = self.client.get('/api/v1/config/game-modes/detail-mode/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['slug'], 'detail-mode')
        self.assertEqual(data['name'], 'Detail Mode')
        for field in ('tick_interval_ms', 'capital_selection_time_seconds', 'starting_energy'):
            self.assertIn(field, data, f"Missing detail field: {field}")

    def test_game_mode_detail_unknown_slug_returns_404(self):
        """GET /config/game-modes/{bad-slug}/ returns 404."""
        resp = self.client.get('/api/v1/config/game-modes/does-not-exist/')
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# MatchmakingFlowIntegrationTests
# ---------------------------------------------------------------------------

class MatchmakingFlowIntegrationTests(TestCase):

    def setUp(self):
        self.client = Client()
        self.game_mode = _make_game_mode()

    def test_full_matchmaking_flow(self):
        """Register 2 users → queue both → try-match → Match created with both players."""
        from apps.matchmaking.models import Match, MatchPlayer

        user1_id, _ = _register_and_login(self.client, 'p1@test.com', 'player1', 'securepass123')
        user2_id, _ = _register_and_login(self.client, 'p2@test.com', 'player2', 'securepass123')

        match_id = _create_match_via_internal(self.client, user1_id, user2_id)

        match = Match.objects.get(id=match_id)
        self.assertIsNotNone(match)
        player_user_ids = set(str(mp.user_id) for mp in match.players.all())
        self.assertIn(user1_id, player_user_ids)
        self.assertIn(user2_id, player_user_ids)

    def test_tutorial_match_creation(self):
        """POST /matches/tutorial/start/ returns match_id and match has is_tutorial=True."""
        from apps.game_config.models import GameMode
        from apps.matchmaking.models import Match

        GameMode.objects.filter(slug='tutorial').delete()
        GameMode.objects.create(
            name='Tutorial',
            slug='tutorial',
            description='Tutorial mode',
            max_players=2,
            min_players=2,
            is_default=False,
            is_active=True,
        )
        _make_tutorial_bot()

        _, token = _register_and_login(self.client, 'tutorial_player@test.com', 'tutplayer', 'securepass123')
        resp = _post_json(self.client, '/api/v1/matches/tutorial/start/', {}, headers=_auth_header(token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('match_id', data)
        match = Match.objects.get(id=data['match_id'])
        self.assertTrue(match.is_tutorial)

    def test_queue_add_remove_flow(self):
        """Add user to queue → count=1 → remove → count=0."""
        from apps.matchmaking.models import MatchQueue

        user = User.objects.create_user(email='queue@test.com', username='queueuser', password='securepass123')

        add_resp = _post_json(self.client, '/api/v1/internal/matchmaking/queue/add/', {
            'user_id': str(user.id),
        }, headers=_internal_header())
        self.assertEqual(add_resp.status_code, 200)
        self.assertEqual(MatchQueue.objects.filter(user=user).count(), 1)

        remove_resp = _post_json(self.client, '/api/v1/internal/matchmaking/queue/remove/', {
            'user_id': str(user.id),
        }, headers=_internal_header())
        self.assertEqual(remove_resp.status_code, 200)
        self.assertEqual(MatchQueue.objects.filter(user=user).count(), 0)

    def test_active_match_detection(self):
        """After creating a match and setting status to in_progress, active-match returns match_id."""
        from apps.matchmaking.models import Match

        user1 = User.objects.create_user(email='am1@test.com', username='am1', password='securepass123')
        user2 = User.objects.create_user(email='am2@test.com', username='am2', password='securepass123')

        match_id = _create_match_via_internal(self.client, user1.id, user2.id)

        # Advance to in_progress so the active-match query picks it up
        Match.objects.filter(id=match_id).update(status=Match.Status.IN_PROGRESS)

        resp = _get_json(
            self.client,
            f'/api/v1/internal/matchmaking/active-match/{user1.id}/',
            headers=_internal_header(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['match_id'], match_id)

    def test_match_history_after_finish(self):
        """After finalization, GET /matches/ includes the match for both players."""
        from apps.matchmaking.models import Match

        user1_id, token1 = _register_and_login(self.client, 'hist1@test.com', 'hist1', 'securepass123')
        user2_id, token2 = _register_and_login(self.client, 'hist2@test.com', 'hist2', 'securepass123')

        match_id = _create_match_via_internal(self.client, user1_id, user2_id)

        # Finalize the match
        finalize_resp = _post_json(self.client, '/api/v1/internal/game/finalize/', {
            'match_id': match_id,
            'winner_id': user1_id,
            'total_ticks': 50,
            'final_state': {
                'regions': {},
                'players': {
                    user1_id: {'is_alive': True, 'total_regions_conquered': 5, 'total_units_produced': 20, 'total_units_lost': 5, 'total_buildings_built': 3},
                    user2_id: {'is_alive': False, 'total_regions_conquered': 2, 'total_units_produced': 10, 'total_units_lost': 10, 'total_buildings_built': 1},
                },
            },
        }, headers=_internal_header())
        self.assertEqual(finalize_resp.status_code, 200)

        history1 = _get_json(self.client, '/api/v1/matches/', headers=_auth_header(token1))
        self.assertEqual(history1.status_code, 200)
        match_ids_1 = [m['id'] for m in history1.json()['items']]
        self.assertIn(match_id, match_ids_1)

        history2 = _get_json(self.client, '/api/v1/matches/', headers=_auth_header(token2))
        self.assertEqual(history2.status_code, 200)
        match_ids_2 = [m['id'] for m in history2.json()['items']]
        self.assertIn(match_id, match_ids_2)


# ---------------------------------------------------------------------------
# GameFlowIntegrationTests
# ---------------------------------------------------------------------------

class GameFlowIntegrationTests(TestCase):

    def setUp(self):
        self.client = Client()
        self.game_mode = _make_game_mode()
        self.user1 = User.objects.create_user(email='g1@test.com', username='gplayer1', password='securepass123')
        self.user2 = User.objects.create_user(email='g2@test.com', username='gplayer2', password='securepass123')
        self.token1 = _login(self.client, 'g1@test.com', 'securepass123')
        self.token2 = _login(self.client, 'g2@test.com', 'securepass123')
        self.match_id = _create_match_via_internal(self.client, self.user1.id, self.user2.id)

    def test_match_data_includes_deck_snapshot_keys(self):
        """GET /internal/matches/{id}/data/ returns players list with deck snapshot fields."""
        resp = _get_json(
            self.client,
            f'/api/v1/internal/matches/{self.match_id}/data/',
            headers=_internal_header(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('players', data)
        self.assertGreaterEqual(len(data['players']), 2)
        for player in data['players']:
            self.assertIn('user_id', player)
            self.assertIn('unlocked_buildings', player)
            self.assertIn('unlocked_units', player)
            self.assertIn('ability_scrolls', player)
            self.assertIn('active_boosts', player)

    def test_save_and_retrieve_snapshot(self):
        """Save a snapshot via internal API then retrieve it via the game endpoint."""
        state = {'regions': {'r1': {'owner': str(self.user1.id)}}, 'tick': 5}

        save_resp = _post_json(self.client, '/api/v1/internal/game/snapshot/', {
            'match_id': self.match_id,
            'tick': 5,
            'state_data': state,
        }, headers=_internal_header())
        self.assertEqual(save_resp.status_code, 200)

        list_resp = _get_json(
            self.client,
            f'/api/v1/game/snapshots/{self.match_id}/',
            headers=_auth_header(self.token1),
        )
        self.assertEqual(list_resp.status_code, 200)
        ticks = [s['tick'] for s in list_resp.json()]
        self.assertIn(5, ticks)

        detail_resp = _get_json(
            self.client,
            f'/api/v1/game/snapshots/{self.match_id}/5/',
            headers=_auth_header(self.token1),
        )
        self.assertEqual(detail_resp.status_code, 200)
        detail = detail_resp.json()
        self.assertEqual(detail['tick'], 5)
        self.assertEqual(detail['state_data']['regions']['r1']['owner'], str(self.user1.id))

    def test_finalize_match_creates_result(self):
        """Finalize match via internal API → GET /game/results/{id}/ returns result."""
        winner_id = str(self.user1.id)
        loser_id = str(self.user2.id)

        finalize_resp = _post_json(self.client, '/api/v1/internal/game/finalize/', {
            'match_id': self.match_id,
            'winner_id': winner_id,
            'total_ticks': 100,
            'final_state': {
                'regions': {},
                'players': {
                    winner_id: {'is_alive': True, 'total_regions_conquered': 8, 'total_units_produced': 40, 'total_units_lost': 5, 'total_buildings_built': 4},
                    loser_id: {'is_alive': False, 'total_regions_conquered': 3, 'total_units_produced': 15, 'total_units_lost': 15, 'total_buildings_built': 1},
                },
            },
        }, headers=_internal_header())
        self.assertEqual(finalize_resp.status_code, 200)

        result_resp = _get_json(
            self.client,
            f'/api/v1/game/results/{self.match_id}/',
            headers=_auth_header(self.token1),
        )
        self.assertEqual(result_resp.status_code, 200)
        result = result_resp.json()
        self.assertEqual(str(result['match_id']), self.match_id)
        self.assertEqual(result['total_ticks'], 100)
        self.assertIn('player_results', result)
        self.assertEqual(len(result['player_results']), 2)

    def test_match_status_transitions(self):
        """Update match status via internal PATCH → correct status reflected."""
        from apps.matchmaking.models import Match

        for new_status in ('in_progress', 'finished'):
            resp = _patch_json(
                self.client,
                f'/api/v1/internal/matches/{self.match_id}/status/',
                {'status': new_status},
                headers=_internal_header(),
            )
            self.assertEqual(resp.status_code, 200, f"Status update to {new_status} failed: {resp.content}")
            match = Match.objects.get(id=self.match_id)
            self.assertEqual(match.status, new_status)

    def test_player_elimination(self):
        """Set player not alive → MatchPlayer.eliminated_at is populated."""
        from apps.matchmaking.models import MatchPlayer

        resp = _patch_json(
            self.client,
            f'/api/v1/internal/matches/{self.match_id}/players/{self.user2.id}/alive/',
            {'is_alive': False},
            headers=_internal_header(),
        )
        self.assertEqual(resp.status_code, 200)

        mp = MatchPlayer.objects.get(match_id=self.match_id, user=self.user2)
        self.assertFalse(mp.is_alive)
        self.assertIsNotNone(mp.eliminated_at)

    def test_snapshot_overwrite_is_idempotent(self):
        """Saving a snapshot for the same (match_id, tick) twice uses update_or_create."""
        from apps.game.models import GameStateSnapshot

        payload = {
            'match_id': self.match_id,
            'tick': 10,
            'state_data': {'v': 1},
        }
        _post_json(self.client, '/api/v1/internal/game/snapshot/', payload, headers=_internal_header())
        payload['state_data'] = {'v': 2}
        _post_json(self.client, '/api/v1/internal/game/snapshot/', payload, headers=_internal_header())

        count = GameStateSnapshot.objects.filter(match_id=self.match_id, tick=10).count()
        self.assertEqual(count, 1)
        snap = GameStateSnapshot.objects.get(match_id=self.match_id, tick=10)
        self.assertEqual(snap.state_data['v'], 2)


# ---------------------------------------------------------------------------
# InternalAPISecurityTests
# ---------------------------------------------------------------------------

class InternalAPISecurityTests(TestCase):

    def setUp(self):
        self.client = Client()
        self.game_mode = _make_game_mode()
        self.user = User.objects.create_user(email='sectest@test.com', username='sectest', password='securepass123')
        # A match is needed for some endpoints
        user2 = User.objects.create_user(email='sectest2@test.com', username='sectest2', password='securepass123')
        self.match_id = _create_match_via_internal(self.client, self.user.id, user2.id)

    def _internal_endpoints(self):
        """Return list of (method, url, payload) tuples for all internal endpoints."""
        uid = str(self.user.id)
        mid = self.match_id
        return [
            ('POST', '/api/v1/internal/matchmaking/queue/add/', {'user_id': uid}),
            ('POST', '/api/v1/internal/matchmaking/queue/remove/', {'user_id': uid}),
            ('GET',  '/api/v1/internal/matchmaking/queue/count/', None),
            ('GET',  f'/api/v1/internal/matchmaking/active-match/{uid}/', None),
            ('POST', '/api/v1/internal/matchmaking/try-match/', {'game_mode': None}),
            ('POST', '/api/v1/internal/game/snapshot/', {'match_id': mid, 'tick': 1, 'state_data': {}}),
            ('POST', '/api/v1/internal/game/finalize/', {'match_id': mid, 'winner_id': uid, 'total_ticks': 1, 'final_state': {}}),
            ('GET',  f'/api/v1/internal/users/{uid}/', None),
            ('GET',  f'/api/v1/internal/matches/{mid}/data/', None),
            ('PATCH', f'/api/v1/internal/matches/{mid}/status/', {'status': 'in_progress'}),
            ('PATCH', f'/api/v1/internal/matches/{mid}/players/{uid}/alive/', {'is_alive': True}),
        ]

    def _call(self, method, url, payload, extra_headers=None):
        kwargs = {}
        if extra_headers:
            kwargs.update(extra_headers)
        if method == 'GET':
            return self.client.get(url, **kwargs)
        if method == 'POST':
            kwargs['content_type'] = 'application/json'
            return self.client.post(url, data=json.dumps(payload or {}), **kwargs)
        if method == 'PATCH':
            kwargs['content_type'] = 'application/json'
            return self.client.patch(url, data=json.dumps(payload or {}), **kwargs)
        raise ValueError(f"Unsupported method: {method}")

    def test_internal_endpoints_reject_without_secret(self):
        """All internal endpoints return 403 when X-Internal-Secret header is absent."""
        for method, url, payload in self._internal_endpoints():
            resp = self._call(method, url, payload)
            self.assertEqual(
                resp.status_code, 403,
                f"Expected 403 for {method} {url} without secret, got {resp.status_code}",
            )

    def test_internal_endpoints_reject_wrong_secret(self):
        """All internal endpoints return 403 when the wrong secret is supplied."""
        wrong_headers = {'HTTP_X_INTERNAL_SECRET': 'wrong-secret-value'}
        for method, url, payload in self._internal_endpoints():
            resp = self._call(method, url, payload, extra_headers=wrong_headers)
            self.assertEqual(
                resp.status_code, 403,
                f"Expected 403 for {method} {url} with wrong secret, got {resp.status_code}",
            )

    def test_internal_endpoints_accept_correct_secret(self):
        """Internal endpoints respond with 2xx when the correct secret is supplied."""
        uid = str(self.user.id)
        mid = self.match_id

        # Spot-check a representative set to avoid side-effects from finalization
        endpoints = [
            ('GET', f'/api/v1/internal/users/{uid}/', None),
            ('GET', f'/api/v1/internal/matches/{mid}/data/', None),
            ('GET', '/api/v1/internal/matchmaking/queue/count/', None),
            ('GET', f'/api/v1/internal/matchmaking/active-match/{uid}/', None),
        ]
        for method, url, payload in endpoints:
            resp = self._call(method, url, payload, extra_headers=_internal_header())
            self.assertIn(
                resp.status_code, (200, 201),
                f"Expected 2xx for {method} {url} with correct secret, got {resp.status_code}: {resp.content}",
            )

    def test_internal_user_endpoint_returns_user_data(self):
        """GET /internal/users/{id}/ returns the correct user info."""
        resp = _get_json(
            self.client,
            f'/api/v1/internal/users/{self.user.id}/',
            headers=_internal_header(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['id'], str(self.user.id))
        self.assertEqual(data['username'], self.user.username)
        self.assertIn('elo_rating', data)
        self.assertIn('is_active', data)

    def test_internal_user_endpoint_returns_404_for_unknown_id(self):
        """GET /internal/users/{id}/ returns 404 for a non-existent UUID."""
        fake_id = str(uuid.uuid4())
        resp = _get_json(self.client, f'/api/v1/internal/users/{fake_id}/', headers=_internal_header())
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# FullGameLifecycleTest
# ---------------------------------------------------------------------------

class FullGameLifecycleTest(TestCase):
    """
    Complete lifecycle:
      Register 2 players → login both → queue → match → get data → save snapshots
      → eliminate p2 → finalize → verify results → verify history → verify snapshots
    """

    def setUp(self):
        self.client = Client()
        self.game_mode = _make_game_mode()

    def test_complete_game_lifecycle(self):
        from apps.matchmaking.models import Match, MatchPlayer
        from apps.game.models import GameStateSnapshot, MatchResult

        # 1. Register 2 players
        p1_id, token1 = _register_and_login(self.client, 'life1@test.com', 'lifecycle1', 'securepass123')
        p2_id, token2 = _register_and_login(self.client, 'life2@test.com', 'lifecycle2', 'securepass123')

        # 2. Add both to queue and create match
        match_id = _create_match_via_internal(self.client, p1_id, p2_id)

        match = Match.objects.get(id=match_id)
        self.assertIsNotNone(match)

        # 3. Get match data and verify players with deck snapshot keys
        data_resp = _get_json(
            self.client,
            f'/api/v1/internal/matches/{match_id}/data/',
            headers=_internal_header(),
        )
        self.assertEqual(data_resp.status_code, 200)
        match_data = data_resp.json()
        self.assertEqual(len(match_data['players']), 2)
        player_ids_in_data = {p['user_id'] for p in match_data['players']}
        self.assertIn(p1_id, player_ids_in_data)
        self.assertIn(p2_id, player_ids_in_data)
        for p in match_data['players']:
            self.assertIn('unlocked_buildings', p)
            self.assertIn('ability_scrolls', p)

        # 4. Advance match to in_progress
        status_resp = _patch_json(
            self.client,
            f'/api/v1/internal/matches/{match_id}/status/',
            {'status': 'in_progress'},
            headers=_internal_header(),
        )
        self.assertEqual(status_resp.status_code, 200)

        # 5. Save game snapshots for ticks 1, 2, 3
        for tick in (1, 2, 3):
            snap_resp = _post_json(self.client, '/api/v1/internal/game/snapshot/', {
                'match_id': match_id,
                'tick': tick,
                'state_data': {
                    'tick': tick,
                    'regions': {},
                    'players': {p1_id: {'units': 10 + tick}, p2_id: {'units': 8}},
                },
            }, headers=_internal_header())
            self.assertEqual(snap_resp.status_code, 200, f"Snapshot tick {tick} failed: {snap_resp.content}")

        self.assertEqual(GameStateSnapshot.objects.filter(match_id=match_id).count(), 3)

        # 6. Eliminate player 2
        elim_resp = _patch_json(
            self.client,
            f'/api/v1/internal/matches/{match_id}/players/{p2_id}/alive/',
            {'is_alive': False},
            headers=_internal_header(),
        )
        self.assertEqual(elim_resp.status_code, 200)
        mp2 = MatchPlayer.objects.get(match_id=match_id, user_id=p2_id)
        self.assertFalse(mp2.is_alive)
        self.assertIsNotNone(mp2.eliminated_at)

        # 7. Finalize match with player 1 as winner
        final_resp = _post_json(self.client, '/api/v1/internal/game/finalize/', {
            'match_id': match_id,
            'winner_id': p1_id,
            'total_ticks': 3,
            'final_state': {
                'regions': {},
                'players': {
                    p1_id: {
                        'is_alive': True,
                        'total_regions_conquered': 10,
                        'total_units_produced': 50,
                        'total_units_lost': 5,
                        'total_buildings_built': 5,
                    },
                    p2_id: {
                        'is_alive': False,
                        'eliminated_tick': 3,
                        'total_regions_conquered': 2,
                        'total_units_produced': 10,
                        'total_units_lost': 10,
                        'total_buildings_built': 1,
                    },
                },
            },
        }, headers=_internal_header())
        self.assertEqual(final_resp.status_code, 200)

        match.refresh_from_db()
        self.assertEqual(match.status, Match.Status.FINISHED)
        self.assertEqual(str(match.winner_id), p1_id)

        # 8. Verify match results
        result_resp = _get_json(
            self.client,
            f'/api/v1/game/results/{match_id}/',
            headers=_auth_header(token1),
        )
        self.assertEqual(result_resp.status_code, 200)
        result = result_resp.json()
        self.assertEqual(result['total_ticks'], 3)
        self.assertEqual(len(result['player_results']), 2)

        # Player 1 should be placement 1 (winner)
        placements = {pr['user_id']: pr['placement'] for pr in result['player_results']}
        self.assertEqual(placements[p1_id], 1)
        self.assertEqual(placements[p2_id], 2)

        # 9. Verify result also accessible by player 2
        result_resp2 = _get_json(
            self.client,
            f'/api/v1/game/results/{match_id}/',
            headers=_auth_header(token2),
        )
        self.assertEqual(result_resp2.status_code, 200)

        # 10. Verify match appears in history for both players
        history1 = _get_json(self.client, '/api/v1/matches/', headers=_auth_header(token1))
        self.assertEqual(history1.status_code, 200)
        self.assertIn(match_id, [m['id'] for m in history1.json()['items']])

        history2 = _get_json(self.client, '/api/v1/matches/', headers=_auth_header(token2))
        self.assertEqual(history2.status_code, 200)
        self.assertIn(match_id, [m['id'] for m in history2.json()['items']])

        # 11. Verify snapshots retrievable
        snap_list_resp = _get_json(
            self.client,
            f'/api/v1/game/snapshots/{match_id}/',
            headers=_auth_header(token1),
        )
        self.assertEqual(snap_list_resp.status_code, 200)
        ticks_in_list = [s['tick'] for s in snap_list_resp.json()]
        # finalize adds a snapshot at tick=total_ticks (3), plus our 3 manually saved = 1,2,3
        for tick in (1, 2, 3):
            self.assertIn(tick, ticks_in_list)

        snap_detail_resp = _get_json(
            self.client,
            f'/api/v1/game/snapshots/{match_id}/2/',
            headers=_auth_header(token1),
        )
        self.assertEqual(snap_detail_resp.status_code, 200)
        self.assertEqual(snap_detail_resp.json()['tick'], 2)
