"""
Tests for apps/accounts — User model and registration API endpoint.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase, Client
import json

User = get_user_model()


# ---------------------------------------------------------------------------
# User model tests
# ---------------------------------------------------------------------------

class UserModelTests(TestCase):
    """Tests for the custom User model."""

    def test_user_created_with_default_elo_rating(self):
        user = User.objects.create_user(
            email='newuser@test.com',
            username='newuser',
            password='securepass123',
        )
        self.assertEqual(user.elo_rating, 1000)

    def test_user_str_is_email(self):
        user = User.objects.create_user(
            email='email@test.com',
            username='emailuser',
            password='securepass123',
        )
        self.assertEqual(str(user), 'email@test.com')

    def test_user_defaults(self):
        user = User.objects.create_user(
            email='defaults@test.com',
            username='defaultsuser',
            password='securepass123',
        )
        self.assertFalse(user.is_bot)
        self.assertFalse(user.is_banned)
        self.assertFalse(user.tutorial_completed)
        self.assertEqual(user.role, User.Role.USER)

    def test_is_admin_property_false_for_regular_user(self):
        user = User.objects.create_user(
            email='regular@test.com',
            username='regularuser',
            password='securepass123',
        )
        self.assertFalse(user.is_admin)

    def test_is_admin_property_true_for_admin_role(self):
        user = User.objects.create_user(
            email='admin@test.com',
            username='adminuser',
            password='securepass123',
            role=User.Role.ADMIN,
        )
        self.assertTrue(user.is_admin)

    def test_email_is_unique(self):
        User.objects.create_user(
            email='unique@test.com',
            username='uniqueuser1',
            password='securepass123',
        )
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            User.objects.create_user(
                email='unique@test.com',
                username='uniqueuser2',
                password='securepass123',
            )

    def test_username_field_is_email(self):
        """USERNAME_FIELD should be 'email' so login uses email."""
        self.assertEqual(User.USERNAME_FIELD, 'email')

    def test_bot_user_creation(self):
        bot = User.objects.create_user(
            email='bot@test.com',
            username='testbot',
            password='securepass123',
            is_bot=True,
        )
        self.assertTrue(bot.is_bot)

    def test_elo_rating_custom_value(self):
        user = User.objects.create_user(
            email='highelo@test.com',
            username='highelo',
            password='securepass123',
            elo_rating=1500,
        )
        self.assertEqual(user.elo_rating, 1500)

    def test_banned_user_flags(self):
        user = User.objects.create_user(
            email='banned@test.com',
            username='banneduser',
            password='securepass123',
        )
        user.is_banned = True
        user.banned_reason = 'Cheating'
        user.save()
        user.refresh_from_db()
        self.assertTrue(user.is_banned)
        self.assertEqual(user.banned_reason, 'Cheating')


# ---------------------------------------------------------------------------
# Registration endpoint tests
# ---------------------------------------------------------------------------

class RegistrationEndpointTests(TestCase):
    """Tests for POST /api/v1/auth/register."""

    def setUp(self):
        self.client = Client()
        self.register_url = '/api/v1/auth/register'

    def _post(self, payload):
        return self.client.post(
            self.register_url,
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_valid_registration_returns_200(self):
        response = self._post({
            'email': 'valid@test.com',
            'username': 'validuser',
            'password': 'securepass123',
        })
        self.assertEqual(response.status_code, 200)

    def test_valid_registration_creates_user(self):
        self._post({
            'email': 'created@test.com',
            'username': 'createduser',
            'password': 'securepass123',
        })
        self.assertTrue(User.objects.filter(email='created@test.com').exists())

    def test_valid_registration_returns_user_data(self):
        response = self._post({
            'email': 'data@test.com',
            'username': 'datauser',
            'password': 'securepass123',
        })
        data = response.json()
        self.assertEqual(data['email'], 'data@test.com')
        self.assertEqual(data['username'], 'datauser')
        self.assertIn('id', data)
        self.assertIn('elo_rating', data)

    def test_duplicate_email_rejected(self):
        payload = {'email': 'dup@test.com', 'username': 'dupuser1', 'password': 'securepass123'}
        self._post(payload)
        response = self._post({'email': 'dup@test.com', 'username': 'dupuser2', 'password': 'securepass123'})
        self.assertEqual(response.status_code, 400)

    def test_duplicate_username_rejected(self):
        self._post({'email': 'user1@test.com', 'username': 'dupname', 'password': 'securepass123'})
        response = self._post({'email': 'user2@test.com', 'username': 'dupname', 'password': 'securepass123'})
        self.assertEqual(response.status_code, 400)

    def test_short_username_rejected(self):
        response = self._post({'email': 'short@test.com', 'username': 'ab', 'password': 'securepass123'})
        self.assertIn(response.status_code, (400, 422))

    def test_short_password_rejected(self):
        response = self._post({'email': 'shortpw@test.com', 'username': 'shortpwuser', 'password': '1234567'})
        self.assertIn(response.status_code, (400, 422))

    def test_invalid_email_rejected(self):
        response = self._post({'email': 'not-an-email', 'username': 'emailtest', 'password': 'securepass123'})
        self.assertEqual(response.status_code, 422)

    def test_missing_fields_rejected(self):
        response = self._post({'email': 'missing@test.com'})
        self.assertEqual(response.status_code, 422)

    def test_new_user_has_default_elo(self):
        self._post({'email': 'elodefault@test.com', 'username': 'elodefault', 'password': 'securepass123'})
        user = User.objects.get(email='elodefault@test.com')
        self.assertEqual(user.elo_rating, 1000)
