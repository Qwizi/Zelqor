import hashlib
import hmac
import random
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.developers.models import (
    VALID_SCOPES,
    DeveloperApp,
    DeviceAuthorizationCode,
    OAuthAccessToken,
    OAuthAuthorizationCode,
)
from apps.developers.schemas import (
    DeviceAuthorizationRequestSchema,
    DeviceAuthorizationResponseSchema,
    DeviceAuthorizeSchema,
    OAuthAuthorizeRequestSchema,
    OAuthClientCredentialsResponseSchema,
    OAuthTokenRequestSchema,
    OAuthTokenResponseSchema,
    OAuthUserInfoSchema,
)
from apps.game_config.decorators import require_module_controller

DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
_DEVICE_EXPIRES_SECONDS = 900  # 15 minutes
_DEVICE_POLL_INTERVAL = 5  # seconds


def _generate_user_code() -> str:
    """Return a human-readable code like 'ABCD-1234'."""
    letters = "".join(random.choices(string.ascii_uppercase, k=4))
    digits = "".join(random.choices(string.digits, k=4))
    return f"{letters}-{digits}"


def _verify_client(client_id: str, client_secret: str):
    """Return the DeveloperApp if credentials are valid, else None."""
    try:
        app = DeveloperApp.objects.get(client_id=client_id, is_active=True)
    except DeveloperApp.DoesNotExist:
        return None
    secret_hash = hashlib.sha256(client_secret.encode()).hexdigest()
    if not hmac.compare_digest(secret_hash, app.client_secret_hash):
        return None
    return app


def _check_rate_limit(request, key_prefix: str, max_attempts: int = 20, window: int = 60) -> None:
    """Simple cache-based rate limiter. Raises HttpError 429 when limit is exceeded."""
    ip = request.META.get("REMOTE_ADDR", "unknown")
    cache_key = f"ratelimit:{key_prefix}:{ip}"
    attempts = cache.get(cache_key, 0)
    if attempts >= max_attempts:
        raise HttpError(429, "Too many requests. Try again later.")
    cache.set(cache_key, attempts + 1, timeout=window)


def _get_bearer_token(request) -> str | None:
    """Extract the Bearer token from the Authorization header."""
    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


@api_controller("/oauth", tags=["OAuth"])
@require_module_controller("developers")
class OAuthController:
    # -------------------------------------------------------------------------
    # POST /oauth/authorize/
    # The authenticated user grants permission to a third-party app.
    # -------------------------------------------------------------------------

    @route.post("/authorize/", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def authorize(self, request, payload: OAuthAuthorizeRequestSchema):
        """Issue an authorization code for the authenticated user."""
        try:
            app = DeveloperApp.objects.get(client_id=payload.client_id, is_active=True)
        except DeveloperApp.DoesNotExist:
            raise HttpError(400, "Invalid client_id or application is inactive.") from None

        requested_scopes = [s.strip() for s in payload.scope.split() if s.strip()]
        invalid_scopes = [s for s in requested_scopes if s not in VALID_SCOPES]
        if invalid_scopes:
            raise HttpError(400, f"Invalid scopes: {', '.join(invalid_scopes)}")

        auth_code = OAuthAuthorizationCode.objects.create(
            app=app,
            user=request.auth,
            redirect_uri=payload.redirect_uri,
            scopes=requested_scopes,
        )

        return {"code": auth_code.code, "state": payload.state}

    # -------------------------------------------------------------------------
    # POST /oauth/token/
    # Public — no Django auth required.
    # -------------------------------------------------------------------------

    # -------------------------------------------------------------------------
    # POST /oauth/device/
    # Public — initiates device authorization flow (RFC 8628).
    # -------------------------------------------------------------------------

    @route.post("/device/", auth=None, response=DeviceAuthorizationResponseSchema)
    def device_authorization(self, request, payload: DeviceAuthorizationRequestSchema):
        """Issue a device_code and user_code to begin the device authorization flow."""
        _check_rate_limit(request, "oauth_device", max_attempts=10, window=60)

        if payload.client_id:
            try:
                app = DeveloperApp.objects.get(client_id=payload.client_id, is_active=True)
            except DeveloperApp.DoesNotExist:
                raise HttpError(400, "Invalid client_id or application is inactive.") from None
        else:
            app = DeveloperApp.get_cli_app()

        # Ensure uniqueness for the short user_code (collision is extremely unlikely
        # but we retry up to 10 times before giving up).
        for _ in range(10):
            user_code = _generate_user_code()
            if not DeviceAuthorizationCode.objects.filter(user_code=user_code).exists():
                break
        else:
            raise HttpError(503, "Could not generate a unique user_code. Please try again.")

        device_code = secrets.token_urlsafe(48)
        expires_at = timezone.now() + timedelta(seconds=_DEVICE_EXPIRES_SECONDS)

        DeviceAuthorizationCode.objects.create(
            app=app,
            device_code=device_code,
            user_code=user_code,
            expires_at=expires_at,
        )

        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        verification_uri = f"{frontend_url.rstrip('/')}/oauth/device"

        return DeviceAuthorizationResponseSchema(
            device_code=device_code,
            user_code=user_code,
            verification_uri=verification_uri,
            expires_in=_DEVICE_EXPIRES_SECONDS,
            interval=_DEVICE_POLL_INTERVAL,
        )

    # -------------------------------------------------------------------------
    # POST /oauth/device/authorize/
    # Authenticated user approves a pending device code.
    # -------------------------------------------------------------------------

    @route.post("/device/authorize/", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def device_authorize(self, request, payload: DeviceAuthorizeSchema):
        """Allow the authenticated user to approve a pending device authorization."""
        _check_rate_limit(request, "oauth_device_authorize", max_attempts=5, window=60)

        try:
            device_record = DeviceAuthorizationCode.objects.select_related("app").get(
                user_code=payload.user_code.upper(),
            )
        except DeviceAuthorizationCode.DoesNotExist:
            raise HttpError(400, "Invalid user_code.") from None

        if device_record.is_expired:
            raise HttpError(400, "Device code has expired.")

        if device_record.is_authorized:
            raise HttpError(400, "Device code has already been authorized.")

        device_record.is_authorized = True
        device_record.user = request.auth
        device_record.save(update_fields=["is_authorized", "user"])

        return {"ok": True}

    # -------------------------------------------------------------------------
    # POST /oauth/token/
    # Public — no Django auth required.
    # -------------------------------------------------------------------------

    @route.post("/token/", auth=None)
    def token(self, request, payload: OAuthTokenRequestSchema):
        """Exchange an authorization code (or refresh token) for an access token."""
        _check_rate_limit(request, "oauth_token")
        if payload.grant_type == "authorization_code":
            return self._grant_authorization_code(payload)
        elif payload.grant_type == "refresh_token":
            return self._grant_refresh_token(payload)
        elif payload.grant_type == "client_credentials":
            return self._grant_client_credentials(payload)
        elif payload.grant_type == DEVICE_CODE_GRANT_TYPE:
            return self._grant_device_code(payload)
        else:
            raise HttpError(
                400,
                'Unsupported grant_type. Use "authorization_code", "refresh_token", "client_credentials", '
                f'or "{DEVICE_CODE_GRANT_TYPE}".',
            )

    def _grant_authorization_code(self, payload: OAuthTokenRequestSchema):
        app = _verify_client(payload.client_id, payload.client_secret)
        if app is None:
            raise HttpError(401, "Invalid client credentials.")

        if not payload.code:
            raise HttpError(400, '"code" is required for authorization_code grant.')

        try:
            auth_code = OAuthAuthorizationCode.objects.select_related("user").get(
                code=payload.code,
                app=app,
            )
        except OAuthAuthorizationCode.DoesNotExist:
            raise HttpError(400, "Authorization code not found.") from None

        if auth_code.used:
            raise HttpError(400, "Authorization code has already been used.")

        if auth_code.is_expired:
            raise HttpError(400, "Authorization code has expired.")

        if auth_code.redirect_uri != payload.redirect_uri:
            raise HttpError(400, "redirect_uri mismatch")

        auth_code.used = True
        auth_code.save(update_fields=["used"])

        token = OAuthAccessToken.objects.create(
            app=app,
            user=auth_code.user,
            scopes=auth_code.scopes,
        )

        expires_in = int((token.expires_at - timezone.now()).total_seconds())
        return OAuthTokenResponseSchema(
            access_token=token.access_token,
            expires_in=expires_in,
            refresh_token=token.refresh_token,
            scope=" ".join(token.scopes),
        )

    def _grant_refresh_token(self, payload: OAuthTokenRequestSchema):
        app = _verify_client(payload.client_id, payload.client_secret)
        if app is None:
            raise HttpError(401, "Invalid client credentials.")

        if not payload.refresh_token:
            raise HttpError(400, '"refresh_token" is required for refresh_token grant.')

        try:
            old_token = OAuthAccessToken.objects.select_related("user").get(
                refresh_token=payload.refresh_token,
                app=app,
            )
        except OAuthAccessToken.DoesNotExist:
            raise HttpError(400, "Refresh token not found.") from None

        if old_token.is_revoked:
            raise HttpError(400, "Refresh token has been revoked.")

        new_token = OAuthAccessToken.objects.create(
            app=app,
            user=old_token.user,
            scopes=old_token.scopes,
        )
        old_token.is_revoked = True
        old_token.save(update_fields=["is_revoked"])

        expires_in = int((new_token.expires_at - timezone.now()).total_seconds())
        return OAuthTokenResponseSchema(
            access_token=new_token.access_token,
            expires_in=expires_in,
            refresh_token=new_token.refresh_token,
            scope=" ".join(new_token.scopes),
        )

    def _grant_client_credentials(self, payload: OAuthTokenRequestSchema):
        app = _verify_client(payload.client_id, payload.client_secret)
        if app is None:
            raise HttpError(401, "Invalid client credentials.")

        if "server:connect" not in (app.allowed_scopes if hasattr(app, "allowed_scopes") else VALID_SCOPES):
            # The scope check: any active app may use server:connect; we just
            # ensure the global VALID_SCOPES list contains it (already true after
            # the models.py change).  If the app has a restricted scope list in
            # future, that check would go here.
            pass

        # Check that server:connect is a valid global scope (guards against
        # misconfiguration where the constant was not updated).
        if "server:connect" not in VALID_SCOPES:
            raise HttpError(403, "server:connect scope is not enabled on this server.")

        token = OAuthAccessToken.objects.create(
            app=app,
            user=app.owner,
            scopes=["server:connect"],
        )

        expires_in = int((token.expires_at - timezone.now()).total_seconds())
        return OAuthClientCredentialsResponseSchema(
            access_token=token.access_token,
            expires_in=expires_in,
            scope="server:connect",
        )

    def _grant_device_code(self, payload: OAuthTokenRequestSchema):
        if not payload.device_code:
            raise HttpError(400, '"device_code" is required for device_code grant.')

        if payload.client_id:
            try:
                app = DeveloperApp.objects.get(client_id=payload.client_id, is_active=True)
            except DeveloperApp.DoesNotExist:
                raise HttpError(400, "Invalid client_id or application is inactive.") from None
        else:
            app = DeveloperApp.get_cli_app()

        try:
            device_record = DeviceAuthorizationCode.objects.select_related("user").get(
                device_code=payload.device_code,
                app=app,
            )
        except DeviceAuthorizationCode.DoesNotExist:
            raise HttpError(400, "Device code not found.") from None

        if device_record.is_expired:
            raise HttpError(400, '{"error": "expired_token"}')

        if not device_record.is_authorized:
            raise HttpError(400, '{"error": "authorization_pending"}')

        user = device_record.user
        device_record.delete()

        # For the built-in CLI app, return JWT tokens so the CLI can access
        # all authenticated endpoints (developer API, etc.) directly.
        if app.client_id == DeveloperApp.CLI_CLIENT_ID:
            from apps.accounts.social_auth import _get_jwt_tokens

            jwt = _get_jwt_tokens(user)
            return OAuthTokenResponseSchema(
                access_token=jwt["access"],
                expires_in=3600,
                refresh_token=jwt["refresh"],
                scope="*",
            )

        # For third-party apps, return an OAuth access token scoped to the app.
        token = OAuthAccessToken.objects.create(
            app=app,
            user=user,
            scopes=device_record.scopes if hasattr(device_record, "scopes") else [],
        )
        expires_in = int((token.expires_at - timezone.now()).total_seconds())
        return OAuthTokenResponseSchema(
            access_token=token.access_token,
            expires_in=expires_in,
            refresh_token=token.refresh_token,
            scope=" ".join(token.scopes),
        )

    # -------------------------------------------------------------------------
    # GET /oauth/userinfo/
    # Bearer token auth (OAuth access token — not a JWT).
    # -------------------------------------------------------------------------

    @route.get("/userinfo/", auth=None, response=OAuthUserInfoSchema)
    def userinfo(self, request):
        """Return the authenticated user's profile."""
        raw_token = _get_bearer_token(request)
        if not raw_token:
            raise HttpError(401, "Bearer token missing.")

        try:
            token = OAuthAccessToken.objects.select_related("user").get(
                access_token=raw_token,
            )
        except OAuthAccessToken.DoesNotExist:
            raise HttpError(401, "Invalid access token.") from None

        if token.is_revoked:
            raise HttpError(401, "Access token has been revoked.")

        if token.is_expired:
            raise HttpError(401, "Access token has expired.")

        if "user:profile" not in token.scopes:
            raise HttpError(403, 'Token does not have the "user:profile" scope.')

        user = token.user
        avatar_url = None
        if user.avatar:
            avatar_url = request.build_absolute_uri(user.avatar.url)

        return OAuthUserInfoSchema(
            id=str(user.id),
            username=user.username,
            email=user.email,
            elo_rating=user.elo_rating,
            avatar=avatar_url,
            date_joined=user.date_joined.isoformat(),
        )

    # -------------------------------------------------------------------------
    # POST /oauth/revoke/
    # Bearer token auth (OAuth access token).
    # -------------------------------------------------------------------------

    @route.post("/revoke/", auth=None)
    def revoke(self, request):
        """Revoke the current OAuth access token."""
        raw_token = _get_bearer_token(request)
        if not raw_token:
            raise HttpError(401, "Bearer token missing.")

        try:
            token = OAuthAccessToken.objects.get(access_token=raw_token)
        except OAuthAccessToken.DoesNotExist:
            raise HttpError(401, "Invalid access token.") from None

        if not token.is_revoked:
            token.is_revoked = True
            token.save(update_fields=["is_revoked"])

        return {"ok": True}

    # -------------------------------------------------------------------------
    # GET /oauth/app-info/
    # Public — no auth required. Used by the consent screen.
    # -------------------------------------------------------------------------

    @route.get("/app-info/", auth=None)
    def app_info(self, request, client_id: str):
        """Return public info about a developer app by client_id."""
        try:
            app = DeveloperApp.objects.get(client_id=client_id, is_active=True)
        except DeveloperApp.DoesNotExist:
            raise HttpError(404, "Application not found.") from None

        return {
            "name": app.name,
            "description": app.description,
            "client_id": app.client_id,
        }
