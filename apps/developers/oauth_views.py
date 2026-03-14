import hashlib

from django.utils import timezone
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from ninja_jwt.authentication import JWTAuth

from apps.developers.models import (
    VALID_SCOPES,
    DeveloperApp,
    OAuthAuthorizationCode,
    OAuthAccessToken,
)
from apps.developers.schemas import (
    OAuthAuthorizeRequestSchema,
    OAuthTokenRequestSchema,
    OAuthTokenResponseSchema,
    OAuthUserInfoSchema,
)


def _verify_client(client_id: str, client_secret: str):
    """Return the DeveloperApp if credentials are valid, else None."""
    try:
        app = DeveloperApp.objects.get(client_id=client_id, is_active=True)
    except DeveloperApp.DoesNotExist:
        return None
    secret_hash = hashlib.sha256(client_secret.encode()).hexdigest()
    if secret_hash != app.client_secret_hash:
        return None
    return app


def _get_bearer_token(request) -> str | None:
    """Extract the Bearer token from the Authorization header."""
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:]
    return None


@api_controller('/oauth', tags=['OAuth'])
class OAuthController:

    # -------------------------------------------------------------------------
    # POST /oauth/authorize/
    # The authenticated user grants permission to a third-party app.
    # -------------------------------------------------------------------------

    @route.post('/authorize/', auth=JWTAuth(), permissions=[IsAuthenticated])
    def authorize(self, request, payload: OAuthAuthorizeRequestSchema):
        """Issue an authorization code for the authenticated user."""
        try:
            app = DeveloperApp.objects.get(client_id=payload.client_id, is_active=True)
        except DeveloperApp.DoesNotExist:
            raise HttpError(400, 'Invalid client_id or application is inactive.')

        requested_scopes = [s.strip() for s in payload.scope.split() if s.strip()]
        invalid_scopes = [s for s in requested_scopes if s not in VALID_SCOPES]
        if invalid_scopes:
            raise HttpError(400, f'Invalid scopes: {", ".join(invalid_scopes)}')

        auth_code = OAuthAuthorizationCode.objects.create(
            app=app,
            user=request.auth,
            redirect_uri=payload.redirect_uri,
            scopes=requested_scopes,
        )

        return {'code': auth_code.code, 'state': payload.state}

    # -------------------------------------------------------------------------
    # POST /oauth/token/
    # Public — no Django auth required.
    # -------------------------------------------------------------------------

    @route.post('/token/', auth=None)
    def token(self, request, payload: OAuthTokenRequestSchema):
        """Exchange an authorization code (or refresh token) for an access token."""
        if payload.grant_type == 'authorization_code':
            return self._grant_authorization_code(payload)
        elif payload.grant_type == 'refresh_token':
            return self._grant_refresh_token(payload)
        else:
            raise HttpError(400, 'Unsupported grant_type. Use "authorization_code" or "refresh_token".')

    def _grant_authorization_code(self, payload: OAuthTokenRequestSchema):
        app = _verify_client(payload.client_id, payload.client_secret)
        if app is None:
            raise HttpError(401, 'Invalid client credentials.')

        if not payload.code:
            raise HttpError(400, '"code" is required for authorization_code grant.')

        try:
            auth_code = OAuthAuthorizationCode.objects.select_related('user').get(
                code=payload.code,
                app=app,
            )
        except OAuthAuthorizationCode.DoesNotExist:
            raise HttpError(400, 'Authorization code not found.')

        if auth_code.used:
            raise HttpError(400, 'Authorization code has already been used.')

        if auth_code.is_expired:
            raise HttpError(400, 'Authorization code has expired.')

        auth_code.used = True
        auth_code.save(update_fields=['used'])

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
            scope=' '.join(token.scopes),
        )

    def _grant_refresh_token(self, payload: OAuthTokenRequestSchema):
        app = _verify_client(payload.client_id, payload.client_secret)
        if app is None:
            raise HttpError(401, 'Invalid client credentials.')

        if not payload.refresh_token:
            raise HttpError(400, '"refresh_token" is required for refresh_token grant.')

        try:
            old_token = OAuthAccessToken.objects.select_related('user').get(
                refresh_token=payload.refresh_token,
                app=app,
            )
        except OAuthAccessToken.DoesNotExist:
            raise HttpError(400, 'Refresh token not found.')

        if old_token.is_revoked:
            raise HttpError(400, 'Refresh token has been revoked.')

        new_token = OAuthAccessToken.objects.create(
            app=app,
            user=old_token.user,
            scopes=old_token.scopes,
        )
        old_token.is_revoked = True
        old_token.save(update_fields=['is_revoked'])

        expires_in = int((new_token.expires_at - timezone.now()).total_seconds())
        return OAuthTokenResponseSchema(
            access_token=new_token.access_token,
            expires_in=expires_in,
            refresh_token=new_token.refresh_token,
            scope=' '.join(new_token.scopes),
        )

    # -------------------------------------------------------------------------
    # GET /oauth/userinfo/
    # Bearer token auth (OAuth access token — not a JWT).
    # -------------------------------------------------------------------------

    @route.get('/userinfo/', auth=None, response=OAuthUserInfoSchema)
    def userinfo(self, request):
        """Return the authenticated user's profile."""
        raw_token = _get_bearer_token(request)
        if not raw_token:
            raise HttpError(401, 'Bearer token missing.')

        try:
            token = OAuthAccessToken.objects.select_related('user').get(
                access_token=raw_token,
            )
        except OAuthAccessToken.DoesNotExist:
            raise HttpError(401, 'Invalid access token.')

        if token.is_revoked:
            raise HttpError(401, 'Access token has been revoked.')

        if token.is_expired:
            raise HttpError(401, 'Access token has expired.')

        if 'user:profile' not in token.scopes:
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

    @route.post('/revoke/', auth=None)
    def revoke(self, request):
        """Revoke the current OAuth access token."""
        raw_token = _get_bearer_token(request)
        if not raw_token:
            raise HttpError(401, 'Bearer token missing.')

        try:
            token = OAuthAccessToken.objects.get(access_token=raw_token)
        except OAuthAccessToken.DoesNotExist:
            raise HttpError(401, 'Invalid access token.')

        if not token.is_revoked:
            token.is_revoked = True
            token.save(update_fields=['is_revoked'])

        return {'ok': True}

    # -------------------------------------------------------------------------
    # GET /oauth/app-info/
    # Public — no auth required. Used by the consent screen.
    # -------------------------------------------------------------------------

    @route.get('/app-info/', auth=None)
    def app_info(self, request, client_id: str):
        """Return public info about a developer app by client_id."""
        try:
            app = DeveloperApp.objects.get(client_id=client_id, is_active=True)
        except DeveloperApp.DoesNotExist:
            raise HttpError(404, 'Application not found.')

        return {
            'name': app.name,
            'description': app.description,
            'client_id': app.client_id,
        }
