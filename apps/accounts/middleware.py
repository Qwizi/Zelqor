from django.contrib.auth import get_user_model
from django.utils import timezone


class LastActiveMiddleware:
    THROTTLE_SECONDS = 60

    def __init__(self, get_response):
        self.get_response = get_response
        self._user_model = None

    @property
    def user_model(self):
        if self._user_model is None:
            self._user_model = get_user_model()
        return self._user_model

    def __call__(self, request):
        response = self.get_response(request)
        user = getattr(request, 'auth', None) or getattr(request, 'user', None)
        if user and getattr(user, 'is_authenticated', False) and hasattr(user, 'pk'):
            now = timezone.now()
            last = getattr(user, 'last_active', None)
            if not last or (now - last).total_seconds() > self.THROTTLE_SECONDS:
                self.user_model.objects.filter(pk=user.pk).update(last_active=now)
        return response
