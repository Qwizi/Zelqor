from celery import shared_task
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone


@shared_task(name="apps.accounts.tasks.flush_last_active")
def flush_last_active():
    """
    Batch-flush user:last_active:* keys from Redis to the DB.

    Uses Django's cache client to scan for all matching keys, then issues
    a single bulk_update so we touch the DB only once per run instead of
    on every authenticated HTTP request.
    """
    User = get_user_model()

    # Access the underlying redis-py client through Django's cache backend.
    # django.core.cache.backends.redis.RedisCache exposes get_client().
    redis_client = cache.get_client()
    pattern = "user:last_active:*"

    # SCAN is non-blocking and safe for production Redis.
    keys = list(redis_client.scan_iter(pattern))
    if not keys:
        return

    # Fetch all values in one round-trip.
    values = redis_client.mget(keys)

    # Build a mapping of user_id -> parsed datetime, skipping any stale/missing values.
    updates = {}
    for key, value in zip(keys, values, strict=False):
        if value is None:
            continue
        try:
            # Key bytes format: b':<db>:user:last_active:<user_id>'
            # Extract the user_id from the last segment.
            key_str = key.decode() if isinstance(key, bytes) else key
            user_id = int(key_str.rsplit(":", 1)[-1])
            last_active = timezone.datetime.fromisoformat(value.decode() if isinstance(value, bytes) else value)
            updates[user_id] = last_active
        except (ValueError, AttributeError):
            continue

    if not updates:
        return

    # Load only the users that need updating, then bulk_update in one query.
    users = list(User.objects.filter(pk__in=updates.keys()).only("pk", "last_active"))
    for user in users:
        user.last_active = updates[user.pk]

    User.objects.bulk_update(users, ["last_active"])

    # Delete the flushed keys so they don't get re-flushed with stale timestamps.
    redis_client.delete(*keys)
