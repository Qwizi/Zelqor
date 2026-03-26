from typing import Any

from django.conf import settings
from django.http import HttpRequest
from ninja_jwt.authentication import JWTAuth


class ActiveUserJWTAuth(JWTAuth):
    """JWT auth that also verifies the user is not banned.

    Django Ninja JWT validates the token signature and expiry, but by default
    it does NOT check ``user.is_banned``.  This subclass adds that check so
    that a banned user is rejected on every request even while their token
    is still cryptographically valid.

    Token resolution order:
    1. Standard ``Authorization: Bearer <token>`` header (existing behaviour).
    2. httpOnly cookie named ``settings.JWT_COOKIE_NAME`` (new cookie flow).
    """

    def __call__(self, request: HttpRequest) -> Any | None:
        # 1. Try the standard Authorization header via the parent __call__.
        result = super().__call__(request)
        if result is not None:
            return result

        # 2. Fallback: read from httpOnly cookie.
        cookie_name = getattr(settings, "JWT_COOKIE_NAME", None)
        if not cookie_name:
            return None
        token = request.COOKIES.get(cookie_name)
        if not token:
            return None
        return self.authenticate(request, token)

    def authenticate(self, request: HttpRequest, token: str) -> Any:
        user = super().authenticate(request, token)
        if user is not None and getattr(user, "is_banned", False):
            return None
        return user
