"""
Test settings for MapLord — uses SQLite in-memory so tests can run
without a PostgreSQL server.
"""

from config.settings import *  # noqa: F401, F403

# Use plain SQLite in-memory — no external DB needed.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

ROOT_URLCONF = "config.test_urls"

# Disable Redis cache in tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Disable Celery task execution (run tasks eagerly in tests, but don't use broker)
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = "memory://"

# Speed up password hashing in tests
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# Use a simpler internal secret for tests
INTERNAL_SECRET = "test-internal-secret"
