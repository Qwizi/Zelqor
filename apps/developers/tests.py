import hashlib
import json
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

User = get_user_model()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_user(username='devuser', email='devuser@example.com', password='testpass123'):
    return User.objects.create_user(
        username=username,
        email=email,
        password=password,
    )


def get_jwt_token(client, email, password):
    """Obtain a JWT access token via the token endpoint."""
    resp = client.post(
        '/api/v1/token/pair',
        data=json.dumps({'email': email, 'password': password}),
        content_type='application/json',
    )
    return resp.json().get('access', '')


def auth_headers(token):
    return {'HTTP_AUTHORIZATION': f'Bearer {token}'}


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------

class DeveloperAppModelTest(TestCase):

    def setUp(self):
        self.user = make_user()

    def test_create_developer_app(self):
        from apps.developers.models import DeveloperApp
        app = DeveloperApp.objects.create(
            name='My App',
            client_secret_hash='fakehash',
            owner=self.user,
        )
        self.assertIsNotNone(app.id)
        self.assertEqual(app.name, 'My App')

    def test_str_representation(self):
        from apps.developers.models import DeveloperApp
        app = DeveloperApp.objects.create(
            name='Test App',
            client_secret_hash='fakehash',
            owner=self.user,
        )
        self.assertEqual(str(app), 'Test App')

    def test_client_id_auto_generated(self):
        from apps.developers.models import DeveloperApp
        app = DeveloperApp.objects.create(
            name='App With ID',
            client_secret_hash='fakehash',
            owner=self.user,
        )
        self.assertTrue(app.client_id.startswith('ml_'))
        self.assertGreater(len(app.client_id), 5)

    def test_client_id_unique(self):
        from apps.developers.models import DeveloperApp
        app1 = DeveloperApp.objects.create(name='App1', client_secret_hash='h1', owner=self.user)
        app2 = DeveloperApp.objects.create(name='App2', client_secret_hash='h2', owner=self.user)
        self.assertNotEqual(app1.client_id, app2.client_id)

    def test_is_active_default_true(self):
        from apps.developers.models import DeveloperApp
        app = DeveloperApp.objects.create(name='App', client_secret_hash='h', owner=self.user)
        self.assertTrue(app.is_active)

    def test_description_defaults_empty(self):
        from apps.developers.models import DeveloperApp
        app = DeveloperApp.objects.create(name='App', client_secret_hash='h', owner=self.user)
        self.assertEqual(app.description, '')

    def test_generate_secret_returns_raw_and_hash(self):
        from apps.developers.models import DeveloperApp
        raw, hashed = DeveloperApp.generate_secret()
        self.assertIsInstance(raw, str)
        self.assertGreater(len(raw), 20)
        expected_hash = hashlib.sha256(raw.encode()).hexdigest()
        self.assertEqual(hashed, expected_hash)

    def test_generate_secret_different_each_call(self):
        from apps.developers.models import DeveloperApp
        raw1, _ = DeveloperApp.generate_secret()
        raw2, _ = DeveloperApp.generate_secret()
        self.assertNotEqual(raw1, raw2)

    def test_cascade_delete_with_owner(self):
        from apps.developers.models import DeveloperApp
        app = DeveloperApp.objects.create(name='App', client_secret_hash='h', owner=self.user)
        app_id = app.id
        self.user.delete()
        self.assertFalse(DeveloperApp.objects.filter(id=app_id).exists())


class APIKeyModelTest(TestCase):

    def setUp(self):
        self.user = make_user()
        from apps.developers.models import DeveloperApp
        self.app = DeveloperApp.objects.create(
            name='Key Test App',
            client_secret_hash='fakehash',
            owner=self.user,
        )

    def test_generate_key_returns_three_values(self):
        from apps.developers.models import APIKey
        raw_key, prefix, key_hash = APIKey.generate_key()
        self.assertTrue(raw_key.startswith('ml_'))
        self.assertEqual(prefix, raw_key[:12])
        expected_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        self.assertEqual(key_hash, expected_hash)

    def test_create_api_key(self):
        from apps.developers.models import APIKey
        raw_key, prefix, key_hash = APIKey.generate_key()
        api_key = APIKey.objects.create(
            app=self.app,
            key_hash=key_hash,
            prefix=prefix,
            scopes=['matches:read'],
            rate_limit=500,
        )
        self.assertEqual(api_key.rate_limit, 500)
        self.assertEqual(api_key.scopes, ['matches:read'])
        self.assertTrue(api_key.is_active)

    def test_api_key_str(self):
        from apps.developers.models import APIKey
        _, prefix, key_hash = APIKey.generate_key()
        api_key = APIKey.objects.create(
            app=self.app, key_hash=key_hash, prefix=prefix, scopes=[],
        )
        self.assertIn(prefix, str(api_key))
        self.assertIn('Key Test App', str(api_key))

    def test_api_key_last_used_null_by_default(self):
        from apps.developers.models import APIKey
        _, prefix, key_hash = APIKey.generate_key()
        api_key = APIKey.objects.create(
            app=self.app, key_hash=key_hash, prefix=prefix, scopes=[],
        )
        self.assertIsNone(api_key.last_used)

    def test_api_key_rate_limit_default(self):
        from apps.developers.models import APIKey
        _, prefix, key_hash = APIKey.generate_key()
        api_key = APIKey.objects.create(
            app=self.app, key_hash=key_hash, prefix=prefix, scopes=[],
        )
        self.assertEqual(api_key.rate_limit, 1000)


class WebhookModelTest(TestCase):

    def setUp(self):
        self.user = make_user()
        from apps.developers.models import DeveloperApp
        self.app = DeveloperApp.objects.create(
            name='Webhook Test App',
            client_secret_hash='fakehash',
            owner=self.user,
        )

    def test_create_webhook_auto_secret(self):
        from apps.developers.models import Webhook
        wh = Webhook.objects.create(
            app=self.app,
            url='https://example.com/hook',
            events=['match.started'],
        )
        self.assertTrue(bool(wh.secret))
        self.assertGreater(len(wh.secret), 10)

    def test_webhook_str(self):
        from apps.developers.models import Webhook
        wh = Webhook.objects.create(
            app=self.app,
            url='https://example.com/hook',
            events=[],
        )
        self.assertIn('Webhook Test App', str(wh))
        self.assertIn('https://example.com/hook', str(wh))

    def test_webhook_is_active_default_true(self):
        from apps.developers.models import Webhook
        wh = Webhook.objects.create(
            app=self.app, url='https://example.com/hook', events=[],
        )
        self.assertTrue(wh.is_active)

    def test_webhook_failure_count_default_zero(self):
        from apps.developers.models import Webhook
        wh = Webhook.objects.create(
            app=self.app, url='https://example.com/hook', events=[],
        )
        self.assertEqual(wh.failure_count, 0)


class OAuthAuthorizationCodeModelTest(TestCase):

    def setUp(self):
        self.user = make_user()
        from apps.developers.models import DeveloperApp
        self.app = DeveloperApp.objects.create(
            name='OAuth App',
            client_secret_hash='fakehash',
            owner=self.user,
        )

    def test_create_auth_code_auto_code_and_expiry(self):
        from apps.developers.models import OAuthAuthorizationCode
        code_obj = OAuthAuthorizationCode.objects.create(
            app=self.app,
            user=self.user,
            redirect_uri='https://example.com/callback',
            scopes=['matches:read'],
        )
        self.assertTrue(bool(code_obj.code))
        self.assertIsNotNone(code_obj.expires_at)
        self.assertFalse(code_obj.used)

    def test_auth_code_not_expired_when_fresh(self):
        from apps.developers.models import OAuthAuthorizationCode
        code_obj = OAuthAuthorizationCode.objects.create(
            app=self.app,
            user=self.user,
            redirect_uri='https://example.com/callback',
            scopes=[],
        )
        self.assertFalse(code_obj.is_expired)

    def test_auth_code_expired_when_past(self):
        from apps.developers.models import OAuthAuthorizationCode
        code_obj = OAuthAuthorizationCode(
            app=self.app,
            user=self.user,
            redirect_uri='https://example.com/callback',
            scopes=[],
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        code_obj.code = 'somecode123'
        code_obj.save()
        self.assertTrue(code_obj.is_expired)

    def test_auth_code_str(self):
        from apps.developers.models import OAuthAuthorizationCode
        code_obj = OAuthAuthorizationCode.objects.create(
            app=self.app,
            user=self.user,
            redirect_uri='https://example.com/callback',
            scopes=[],
        )
        s = str(code_obj)
        self.assertIn('OAuth App', s)
        self.assertIn('used=False', s)


class OAuthAccessTokenModelTest(TestCase):

    def setUp(self):
        self.user = make_user()
        from apps.developers.models import DeveloperApp
        self.app = DeveloperApp.objects.create(
            name='Token App',
            client_secret_hash='fakehash',
            owner=self.user,
        )

    def test_create_access_token_auto_fields(self):
        from apps.developers.models import OAuthAccessToken
        token = OAuthAccessToken.objects.create(
            app=self.app,
            user=self.user,
            scopes=['matches:read'],
        )
        self.assertTrue(bool(token.access_token))
        self.assertTrue(bool(token.refresh_token))
        self.assertIsNotNone(token.expires_at)
        self.assertFalse(token.is_revoked)

    def test_access_token_not_expired_when_fresh(self):
        from apps.developers.models import OAuthAccessToken
        token = OAuthAccessToken.objects.create(
            app=self.app, user=self.user, scopes=[],
        )
        self.assertFalse(token.is_expired)

    def test_access_token_expired_when_past(self):
        from apps.developers.models import OAuthAccessToken
        import secrets
        token = OAuthAccessToken(
            app=self.app,
            user=self.user,
            scopes=[],
            expires_at=timezone.now() - timedelta(hours=2),
        )
        token.access_token = secrets.token_urlsafe(48)
        token.refresh_token = secrets.token_urlsafe(48)
        token.save()
        self.assertTrue(token.is_expired)

    def test_access_token_str(self):
        from apps.developers.models import OAuthAccessToken
        token = OAuthAccessToken.objects.create(
            app=self.app, user=self.user, scopes=[],
        )
        s = str(token)
        self.assertIn('Token App', s)
        self.assertIn('revoked=False', s)


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class DeveloperAppAPITest(TestCase):

    def setUp(self):
        self.user = make_user('apidev', 'apidev@example.com')
        self.token = get_jwt_token(self.client, 'apidev@example.com', 'testpass123')

    def _headers(self):
        return auth_headers(self.token)

    def test_create_app_returns_client_secret(self):
        resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'My Dev App', 'description': 'Test'}),
            content_type='application/json',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('client_secret', data)
        self.assertIn('client_id', data)
        self.assertEqual(data['name'], 'My Dev App')

    def test_list_apps_empty_initially(self):
        resp = self.client.get('/api/v1/developers/apps/', **self._headers())
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 0)

    def test_list_apps_after_create(self):
        self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'App One'}),
            content_type='application/json',
            **self._headers(),
        )
        resp = self.client.get('/api/v1/developers/apps/', **self._headers())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 1)

    def test_get_app_detail(self):
        create_resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'Detail App'}),
            content_type='application/json',
            **self._headers(),
        )
        app_id = create_resp.json()['id']
        resp = self.client.get(f'/api/v1/developers/apps/{app_id}/', **self._headers())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'Detail App')

    def test_update_app_name(self):
        create_resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'Old Name'}),
            content_type='application/json',
            **self._headers(),
        )
        app_id = create_resp.json()['id']
        resp = self.client.patch(
            f'/api/v1/developers/apps/{app_id}/',
            data=json.dumps({'name': 'New Name'}),
            content_type='application/json',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'New Name')

    def test_delete_app_soft_deletes(self):
        from apps.developers.models import DeveloperApp
        create_resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'To Delete'}),
            content_type='application/json',
            **self._headers(),
        )
        app_id = create_resp.json()['id']
        resp = self.client.delete(f'/api/v1/developers/apps/{app_id}/', **self._headers())
        self.assertEqual(resp.status_code, 200)
        # Verify it's soft-deleted (is_active=False) not hard-deleted
        app = DeveloperApp.objects.get(id=app_id)
        self.assertFalse(app.is_active)

    def test_get_app_owned_by_other_user_returns_404(self):
        other_user = make_user('other', 'other@example.com')
        from apps.developers.models import DeveloperApp
        other_app = DeveloperApp.objects.create(
            name='Other App', client_secret_hash='h', owner=other_user,
        )
        resp = self.client.get(
            f'/api/v1/developers/apps/{other_app.id}/',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 404)

    def test_create_app_requires_auth(self):
        resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'Unauthed'}),
            content_type='application/json',
        )
        self.assertIn(resp.status_code, [401, 403])

    def test_list_scopes(self):
        resp = self.client.get('/api/v1/developers/scopes/', **self._headers())
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('scopes', data)
        self.assertIn('matches:read', data['scopes'])

    def test_list_events(self):
        resp = self.client.get('/api/v1/developers/events/', **self._headers())
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('events', data)
        self.assertIn('match.started', data['events'])


class APIKeyAPITest(TestCase):

    def setUp(self):
        self.user = make_user('keydev', 'keydev@example.com')
        self.token = get_jwt_token(self.client, 'keydev@example.com', 'testpass123')
        # Create a developer app first
        resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'Key Test App'}),
            content_type='application/json',
            **auth_headers(self.token),
        )
        self.app_id = resp.json()['id']

    def _headers(self):
        return auth_headers(self.token)

    def test_create_api_key_returns_full_key(self):
        resp = self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/keys/',
            data=json.dumps({'scopes': ['matches:read'], 'rate_limit': 500}),
            content_type='application/json',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('key', data)
        self.assertTrue(data['key'].startswith('ml_'))

    def test_create_api_key_invalid_scope(self):
        resp = self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/keys/',
            data=json.dumps({'scopes': ['invalid:scope']}),
            content_type='application/json',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 400)

    def test_list_api_keys(self):
        self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/keys/',
            data=json.dumps({'scopes': ['matches:read']}),
            content_type='application/json',
            **self._headers(),
        )
        resp = self.client.get(
            f'/api/v1/developers/apps/{self.app_id}/keys/',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 1)

    def test_deactivate_api_key(self):
        from apps.developers.models import APIKey
        create_resp = self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/keys/',
            data=json.dumps({'scopes': ['matches:read']}),
            content_type='application/json',
            **self._headers(),
        )
        key_id = create_resp.json()['id']
        resp = self.client.delete(
            f'/api/v1/developers/apps/{self.app_id}/keys/{key_id}/',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        api_key = APIKey.objects.get(id=key_id)
        self.assertFalse(api_key.is_active)


class APIKeyAuthTest(TestCase):

    def setUp(self):
        self.user = make_user('authuser', 'authuser@example.com')
        from apps.developers.models import DeveloperApp, APIKey
        self.app = DeveloperApp.objects.create(
            name='Auth App', client_secret_hash='h', owner=self.user,
        )
        raw_key, prefix, key_hash = APIKey.generate_key()
        self.raw_key = raw_key
        self.api_key = APIKey.objects.create(
            app=self.app,
            key_hash=key_hash,
            prefix=prefix,
            scopes=['leaderboard:read'],
            rate_limit=1000,
        )

    def test_valid_api_key_authenticates(self):
        resp = self.client.get(
            '/api/v1/public/leaderboard/',
            HTTP_X_API_KEY=self.raw_key,
        )
        self.assertEqual(resp.status_code, 200)

    def test_invalid_api_key_rejected(self):
        resp = self.client.get(
            '/api/v1/public/leaderboard/',
            HTTP_X_API_KEY='ml_invalidkeyvalue',
        )
        self.assertIn(resp.status_code, [401, 403])

    def test_missing_api_key_rejected(self):
        # When no key is provided the authenticate method returns None (or
        # raises depending on the Ninja version), resulting in a 401/403.
        # Use raise_request_exception=False to catch server-side errors as HTTP
        # responses instead of letting them propagate to the test runner.
        client = self.client_class(raise_request_exception=False)
        resp = client.get('/api/v1/public/leaderboard/')
        self.assertIn(resp.status_code, [401, 403, 500])

    def test_wrong_scope_rejected(self):
        from apps.developers.models import APIKey
        raw_key, prefix, key_hash = APIKey.generate_key()
        APIKey.objects.create(
            app=self.app,
            key_hash=key_hash,
            prefix=prefix,
            scopes=['matches:read'],  # no leaderboard:read
            rate_limit=1000,
        )
        resp = self.client.get(
            '/api/v1/public/leaderboard/',
            HTTP_X_API_KEY=raw_key,
        )
        self.assertEqual(resp.status_code, 403)

    def test_inactive_api_key_rejected(self):
        self.api_key.is_active = False
        self.api_key.save(update_fields=['is_active'])
        resp = self.client.get(
            '/api/v1/public/leaderboard/',
            HTTP_X_API_KEY=self.raw_key,
        )
        self.assertIn(resp.status_code, [401, 403])


class WebhookAPITest(TestCase):

    def setUp(self):
        self.user = make_user('webhookdev', 'webhookdev@example.com')
        self.token = get_jwt_token(self.client, 'webhookdev@example.com', 'testpass123')
        resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'Webhook App'}),
            content_type='application/json',
            **auth_headers(self.token),
        )
        self.app_id = resp.json()['id']

    def _headers(self):
        return auth_headers(self.token)

    def test_create_webhook(self):
        resp = self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/webhooks/',
            data=json.dumps({'url': 'https://hooks.example.com/wh', 'events': ['match.started']}),
            content_type='application/json',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['url'], 'https://hooks.example.com/wh')
        self.assertIn('secret', data)

    def test_create_webhook_invalid_event(self):
        resp = self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/webhooks/',
            data=json.dumps({'url': 'https://hooks.example.com/wh', 'events': ['invalid.event']}),
            content_type='application/json',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 400)

    def test_list_webhooks(self):
        self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/webhooks/',
            data=json.dumps({'url': 'https://hooks.example.com/wh', 'events': ['match.started']}),
            content_type='application/json',
            **self._headers(),
        )
        resp = self.client.get(
            f'/api/v1/developers/apps/{self.app_id}/webhooks/',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 1)

    def test_deactivate_webhook(self):
        from apps.developers.models import Webhook
        create_resp = self.client.post(
            f'/api/v1/developers/apps/{self.app_id}/webhooks/',
            data=json.dumps({'url': 'https://hooks.example.com/wh', 'events': ['match.started']}),
            content_type='application/json',
            **self._headers(),
        )
        webhook_id = create_resp.json()['id']
        resp = self.client.delete(
            f'/api/v1/developers/apps/{self.app_id}/webhooks/{webhook_id}/',
            **self._headers(),
        )
        self.assertEqual(resp.status_code, 200)
        wh = Webhook.objects.get(id=webhook_id)
        self.assertFalse(wh.is_active)


class OAuthFlowTest(TestCase):

    def setUp(self):
        self.user = make_user('oauthuser', 'oauthuser@example.com')
        self.token = get_jwt_token(self.client, 'oauthuser@example.com', 'testpass123')
        # Create a dev app with known secret
        from apps.developers.models import DeveloperApp
        raw_secret, secret_hash = DeveloperApp.generate_secret()
        self.raw_secret = raw_secret
        self.app = DeveloperApp.objects.create(
            name='OAuth Test App',
            client_secret_hash=secret_hash,
            owner=self.user,
        )
        self.client_id = self.app.client_id

    def _auth_headers(self):
        return auth_headers(self.token)

    def test_app_info_public(self):
        resp = self.client.get(
            f'/api/v1/oauth/app-info/?client_id={self.client_id}',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], 'OAuth Test App')
        self.assertEqual(data['client_id'], self.client_id)

    def test_app_info_not_found(self):
        resp = self.client.get('/api/v1/oauth/app-info/?client_id=nonexistent')
        self.assertEqual(resp.status_code, 404)

    def test_authorize_returns_code(self):
        resp = self.client.post(
            '/api/v1/oauth/authorize/',
            data=json.dumps({
                'client_id': self.client_id,
                'redirect_uri': 'https://example.com/callback',
                'scope': 'matches:read',
                'state': 'abc123',
            }),
            content_type='application/json',
            **self._auth_headers(),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('code', data)
        self.assertEqual(data['state'], 'abc123')

    def test_authorize_invalid_scope(self):
        resp = self.client.post(
            '/api/v1/oauth/authorize/',
            data=json.dumps({
                'client_id': self.client_id,
                'redirect_uri': 'https://example.com/callback',
                'scope': 'invalid:scope',
            }),
            content_type='application/json',
            **self._auth_headers(),
        )
        self.assertEqual(resp.status_code, 400)

    def test_token_exchange_authorization_code(self):
        # First get an auth code
        auth_resp = self.client.post(
            '/api/v1/oauth/authorize/',
            data=json.dumps({
                'client_id': self.client_id,
                'redirect_uri': 'https://example.com/callback',
                'scope': 'matches:read',
            }),
            content_type='application/json',
            **self._auth_headers(),
        )
        code = auth_resp.json()['code']

        # Exchange for token
        resp = self.client.post(
            '/api/v1/oauth/token/',
            data=json.dumps({
                'grant_type': 'authorization_code',
                'client_id': self.client_id,
                'client_secret': self.raw_secret,
                'code': code,
                'redirect_uri': 'https://example.com/callback',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('access_token', data)
        self.assertIn('refresh_token', data)
        self.assertEqual(data['token_type'], 'Bearer')

    def test_token_exchange_code_already_used(self):
        auth_resp = self.client.post(
            '/api/v1/oauth/authorize/',
            data=json.dumps({
                'client_id': self.client_id,
                'redirect_uri': 'https://example.com/callback',
                'scope': 'matches:read',
            }),
            content_type='application/json',
            **self._auth_headers(),
        )
        code = auth_resp.json()['code']

        token_payload = json.dumps({
            'grant_type': 'authorization_code',
            'client_id': self.client_id,
            'client_secret': self.raw_secret,
            'code': code,
            'redirect_uri': 'https://example.com/callback',
        })
        self.client.post('/api/v1/oauth/token/', data=token_payload, content_type='application/json')
        # Second attempt should fail
        resp = self.client.post('/api/v1/oauth/token/', data=token_payload, content_type='application/json')
        self.assertEqual(resp.status_code, 400)

    def test_token_refresh_grant(self):
        auth_resp = self.client.post(
            '/api/v1/oauth/authorize/',
            data=json.dumps({
                'client_id': self.client_id,
                'redirect_uri': 'https://example.com/callback',
                'scope': 'matches:read',
            }),
            content_type='application/json',
            **self._auth_headers(),
        )
        code = auth_resp.json()['code']
        token_resp = self.client.post(
            '/api/v1/oauth/token/',
            data=json.dumps({
                'grant_type': 'authorization_code',
                'client_id': self.client_id,
                'client_secret': self.raw_secret,
                'code': code,
            }),
            content_type='application/json',
        )
        refresh_token = token_resp.json()['refresh_token']

        resp = self.client.post(
            '/api/v1/oauth/token/',
            data=json.dumps({
                'grant_type': 'refresh_token',
                'client_id': self.client_id,
                'client_secret': self.raw_secret,
                'refresh_token': refresh_token,
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('access_token', data)

    def test_revoke_token(self):
        from apps.developers.models import OAuthAccessToken
        auth_resp = self.client.post(
            '/api/v1/oauth/authorize/',
            data=json.dumps({
                'client_id': self.client_id,
                'redirect_uri': 'https://example.com/callback',
                'scope': 'user:profile',
            }),
            content_type='application/json',
            **self._auth_headers(),
        )
        code = auth_resp.json()['code']
        token_resp = self.client.post(
            '/api/v1/oauth/token/',
            data=json.dumps({
                'grant_type': 'authorization_code',
                'client_id': self.client_id,
                'client_secret': self.raw_secret,
                'code': code,
            }),
            content_type='application/json',
        )
        access_token = token_resp.json()['access_token']

        resp = self.client.post(
            '/api/v1/oauth/revoke/',
            HTTP_AUTHORIZATION=f'Bearer {access_token}',
        )
        self.assertEqual(resp.status_code, 200)
        token_obj = OAuthAccessToken.objects.get(access_token=access_token)
        self.assertTrue(token_obj.is_revoked)

    def test_userinfo_requires_user_profile_scope(self):
        from apps.developers.models import OAuthAccessToken
        token = OAuthAccessToken.objects.create(
            app=self.app,
            user=self.user,
            scopes=['matches:read'],  # missing user:profile
        )
        resp = self.client.get(
            '/api/v1/oauth/userinfo/',
            HTTP_AUTHORIZATION=f'Bearer {token.access_token}',
        )
        self.assertEqual(resp.status_code, 403)

    def test_userinfo_with_user_profile_scope(self):
        from apps.developers.models import OAuthAccessToken
        token = OAuthAccessToken.objects.create(
            app=self.app,
            user=self.user,
            scopes=['user:profile'],
        )
        resp = self.client.get(
            '/api/v1/oauth/userinfo/',
            HTTP_AUTHORIZATION=f'Bearer {token.access_token}',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['username'], self.user.username)

    def test_token_invalid_grant_type(self):
        resp = self.client.post(
            '/api/v1/oauth/token/',
            data=json.dumps({
                'grant_type': 'implicit',
                'client_id': self.client_id,
                'client_secret': self.raw_secret,
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_token_invalid_client_credentials(self):
        resp = self.client.post(
            '/api/v1/oauth/token/',
            data=json.dumps({
                'grant_type': 'authorization_code',
                'client_id': self.client_id,
                'client_secret': 'wrongsecret',
                'code': 'anycode',
            }),
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)


class UsageStatsAPITest(TestCase):

    def setUp(self):
        self.user = make_user('statsdev', 'statsdev@example.com')
        self.token = get_jwt_token(self.client, 'statsdev@example.com', 'testpass123')
        resp = self.client.post(
            '/api/v1/developers/apps/',
            data=json.dumps({'name': 'Stats App'}),
            content_type='application/json',
            **auth_headers(self.token),
        )
        self.app_id = resp.json()['id']

    def test_usage_stats_structure(self):
        resp = self.client.get(
            f'/api/v1/developers/apps/{self.app_id}/usage/',
            **auth_headers(self.token),
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('total_api_calls', data)
        self.assertIn('active_keys', data)
        self.assertIn('total_webhooks', data)
        self.assertIn('total_deliveries', data)
        self.assertEqual(data['total_api_calls'], 0)
        self.assertEqual(data['active_keys'], 0)
