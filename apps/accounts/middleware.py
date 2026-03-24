from django.core.cache import cache
from django.utils import timezone


class LastActiveMiddleware:
    THROTTLE_SECONDS = 60
    CACHE_TTL = 120  # Cache key lives 2 min — acts as throttle guard

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        # Ninja JWT sets request.auth to the User instance after view processing.
        # Django's AuthenticationMiddleware sets request.user (AnonymousUser for API).
        user = getattr(request, "auth", None)
        if not user or not hasattr(user, "pk"):
            user = getattr(request, "user", None)
        if user and hasattr(user, "pk") and not getattr(user, "is_anonymous", True):
            cache_key = f"user:last_active:{user.pk}"
            if cache.get(cache_key) is None:
                import logging

                logger = logging.getLogger(__name__)
                from apps.accounts.models import User

                now = timezone.now()
                updated = User.objects.filter(pk=user.pk).update(last_active=now)
                logger.warning(f"[LastActive] Updated last_active for user {user.pk}: rows={updated}, now={now}")
                cache.set(cache_key, "1", timeout=self.THROTTLE_SECONDS)
        return response
