from ninja_jwt.authentication import JWTAuth


class ActiveUserJWTAuth(JWTAuth):
    """JWT auth that also verifies the user is not banned.

    Django Ninja JWT validates the token signature and expiry, but by default
    it does NOT check ``user.is_banned``.  This subclass adds that check so
    that a banned user is rejected on every request even while their token
    is still cryptographically valid.
    """

    def authenticate(self, request, token: str):
        user = super().authenticate(request, token)
        if user is not None and getattr(user, "is_banned", False):
            return None
        return user
