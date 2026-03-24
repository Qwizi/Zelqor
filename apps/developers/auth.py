import hashlib

from django.core.cache import cache
from django.utils import timezone
from ninja.errors import HttpError
from ninja.security import APIKeyHeader

from apps.game_config.modules import get_module_config


class APIKeyAuth(APIKeyHeader):
    param_name = "X-API-Key"

    def authenticate(self, request, key):
        from apps.developers.models import APIKey

        key_hash = hashlib.sha256(key.encode()).hexdigest()
        try:
            api_key = APIKey.objects.select_related("app").get(
                key_hash=key_hash,
                is_active=True,
                app__is_active=True,
            )
        except APIKey.DoesNotExist:
            return None

        # Rate limiting using Redis cache (rolling window configurable via module config)
        rate_limit_window = get_module_config("developers", "rate_limit_window_seconds", 60)
        cache_key = f"ratelimit:apikey:{api_key.id}"
        current = cache.get(cache_key, 0)
        if current >= api_key.rate_limit:
            raise HttpError(429, "Rate limit exceeded. Try again later.")

        # Use incr for atomicity; if key expired between get and incr, reset it
        if current == 0:
            cache.set(cache_key, 1, timeout=rate_limit_window)
        else:
            try:
                cache.incr(cache_key)
            except ValueError:
                cache.set(cache_key, 1, timeout=rate_limit_window)

        # Store rate limit info on request so middleware can add response headers
        request.rate_limit_info = {
            "limit": api_key.rate_limit,
            "remaining": max(0, api_key.rate_limit - (current + 1)),
            "reset": rate_limit_window,
        }

        # Track total API usage for stats (rolling counter per key, window configurable)
        usage_tracking_window = get_module_config("developers", "api_usage_tracking_window_seconds", 86400)
        usage_key = f"api_usage:{api_key.app_id}:{api_key.id}"
        try:
            cache.incr(usage_key)
        except ValueError:
            cache.set(usage_key, 1, timeout=usage_tracking_window)

        # Update last_used debounced — only write to DB once per configurable window per key
        last_used_debounce = get_module_config("developers", "last_used_debounce_seconds", 60)
        last_used_cache_key = f"apikey:last_used:{api_key.id}"
        if not cache.get(last_used_cache_key):
            APIKey.objects.filter(id=api_key.id).update(last_used=timezone.now())
            cache.set(last_used_cache_key, True, timeout=last_used_debounce)

        # Attach resolved api_key to request so controllers can check scopes
        request.api_key = api_key
        return api_key


def check_scope(request, scope: str) -> bool:
    """Check if the authenticated API key carries the required scope."""
    return hasattr(request, "api_key") and scope in request.api_key.scopes
