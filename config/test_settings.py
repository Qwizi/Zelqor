"""
Test settings for MapLord — removes PostGIS/GDAL dependencies so tests
can run against a plain PostgreSQL instance.
"""

from config.settings import *  # noqa: F401, F403

# Use standard PostgreSQL backend instead of PostGIS.
# DATABASE NAME is 'maplord' — Django will create 'test_maplord' as the test DB.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "maplord",
        "USER": "maplord",
        "PASSWORD": "maplord",
        "HOST": "localhost",
        "PORT": "5432",
    }
}

# Keep all apps including django.contrib.gis and apps.geo so migration
# dependency chains resolve. The MIGRATION_MODULES override below redirects
# geo to test-only migrations that use plain fields instead of PostGIS types.
# (INSTALLED_APPS is inherited unchanged from config.settings)

# Override geo app migrations to use test-friendly (non-spatial) migrations
MIGRATION_MODULES = {
    "geo": "config.test_geo_migrations",
}

ROOT_URLCONF = "config.test_urls"

# Custom test runner that skips system checks (avoids GDAL/geo admin check failures)
TEST_RUNNER = "config.test_runner.NoCheckTestRunner"

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
