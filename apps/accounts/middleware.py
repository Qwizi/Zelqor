from django.core.cache import cache
from django.utils import timezone


class LastActiveMiddleware:
    THROTTLE_SECONDS = 60
    CACHE_TTL = 600  # 10 minutes — longer than the flush interval so no key expires before flush

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        user = getattr(request, 'auth', None) or getattr(request, 'user', None)
        if user and getattr(user, 'is_authenticated', False) and hasattr(user, 'pk'):
            cache_key = f'user:last_active:{user.pk}'
            now = timezone.now()
            # Only update if key is absent (expired/first hit) or throttle period passed
            existing = cache.get(cache_key)
            if existing is None or (now - timezone.datetime.fromisoformat(existing)).total_seconds() > self.THROTTLE_SECONDS:
                cache.set(cache_key, now.isoformat(), timeout=self.CACHE_TTL)
        return response
