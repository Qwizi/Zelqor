from django.core.cache import cache
from django.utils import timezone


class LastActiveMiddleware:
    THROTTLE_SECONDS = 60
    CACHE_TTL = 120  # Cache key lives 2 min — acts as throttle guard

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        user = getattr(request, 'auth', None) or getattr(request, 'user', None)
        if user and getattr(user, 'is_authenticated', False) and hasattr(user, 'pk'):
            cache_key = f'user:last_active:{user.pk}'
            # Only update once per THROTTLE_SECONDS (cache key acts as guard)
            if cache.get(cache_key) is None:
                from apps.accounts.models import User
                now = timezone.now()
                User.objects.filter(pk=user.pk).update(last_active=now)
                cache.set(cache_key, '1', timeout=self.THROTTLE_SECONDS)
        return response
