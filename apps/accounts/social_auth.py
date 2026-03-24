import secrets
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from ninja import Schema
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from ninja_jwt.tokens import RefreshToken

from apps.accounts.auth import ActiveUserJWTAuth
from apps.accounts.models import SocialAccount
from apps.accounts.schemas import SocialAccountOutSchema
from apps.game_config.decorators import require_module_controller

User = get_user_model()

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SocialAuthURLOut(Schema):
    url: str


class SocialCallbackIn(Schema):
    code: str
    state: str | None = None
    redirect_uri: str  # frontend sends the redirect_uri it used


class SocialAuthTokenOut(Schema):
    access: str
    refresh: str
    is_new_user: bool


# ---------------------------------------------------------------------------
# Provider constants
# ---------------------------------------------------------------------------

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

DISCORD_AUTH_URL = "https://discord.com/api/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_USERINFO_URL = "https://discord.com/api/users/@me"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_jwt_tokens(user) -> dict:
    """Generate a JWT access/refresh token pair for the given user."""
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


def _provision_starter_items(user) -> None:
    """Grant starter inventory, wallet, and default deck to a new user.

    Wrapped in a broad try/except so social registration never fails when
    economy data has not been seeded yet — identical behaviour to the
    regular register endpoint.
    """
    try:
        from apps.inventory.models import Deck, DeckItem, Item, UserInventory, Wallet

        STARTER_SLUGS = [
            "pkg-shield-1",
            "bp-barracks-1",
            "bp-factory-1",
            "bp-tower-1",
            "bp-port-1",
            "bp-carrier-1",
            "bp-radar-1",
        ]

        Wallet.objects.get_or_create(user=user, defaults={"gold": 100})

        for slug in STARTER_SLUGS:
            item = Item.objects.filter(slug=slug).first()
            if item:
                UserInventory.objects.get_or_create(user=user, item=item, defaults={"quantity": 1})

        deck = Deck.objects.create(user=user, name="Domyślna talia", is_default=True)
        for slug in STARTER_SLUGS:
            item = Item.objects.filter(slug=slug).first()
            if item:
                DeckItem.objects.create(deck=deck, item=item, quantity=1)
    except Exception:
        pass


def _build_username(display_name: str, email: str) -> str:
    """Derive a unique username from the provider display name or email."""
    base = display_name or (email.split("@")[0] if email else "user")
    # Keep only alphanumeric, underscore, and hyphen characters; cap at 20.
    base = "".join(c for c in base if c.isalnum() or c in "_-")[:20]
    if not base:
        base = "user"
    username = base
    counter = 1
    while User.objects.filter(username=username).exists():
        username = f"{base}_{counter}"
        counter += 1
    return username


def _get_or_create_user(
    provider: str,
    provider_user_id: str,
    email: str,
    display_name: str,
    avatar_url: str = "",
) -> tuple:
    """Return (user, is_new_user) resolving the social account link.

    Resolution order:
    1. Existing SocialAccount row  → return linked user (no DB writes).
    2. User with matching email exists → link social account, return user.
    3. No match → create new User + SocialAccount + starter items.
    """
    # 1. Known social account
    social = (
        SocialAccount.objects.filter(provider=provider, provider_user_id=provider_user_id)
        .select_related("user")
        .first()
    )
    if social:
        return social.user, False

    # 2. Existing user with the same email
    is_new = False
    user = User.objects.filter(email=email).first() if email else None

    if not user:
        # 3. Brand-new user
        fallback_email = f"{provider}_{provider_user_id}@social.maplord.local"
        username = _build_username(display_name, email)
        user = User.objects.create_user(
            email=email or fallback_email,
            username=username,
            password=None,  # Social-only account — no password set
        )
        is_new = True
        _provision_starter_items(user)

    # Create the social account link for both new and existing-by-email users
    SocialAccount.objects.create(
        user=user,
        provider=provider,
        provider_user_id=provider_user_id,
        email=email,
        display_name=display_name,
        avatar_url=avatar_url,
    )
    return user, is_new


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------


@api_controller("/auth/social", tags=["Social Auth"])
@require_module_controller("social-auth")
class SocialAuthController:
    @route.get("/google/authorize", response=SocialAuthURLOut, auth=None)
    def google_authorize(self, request, redirect_uri: str):
        """Return the Google OAuth2 authorization URL.

        The frontend should redirect the user to the returned URL. After the
        user grants access, Google redirects back to ``redirect_uri`` with a
        ``code`` query parameter.
        """
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
            "prompt": "consent",
            "state": secrets.token_urlsafe(32),
        }
        return {"url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}

    @route.post("/google/callback", response=SocialAuthTokenOut, auth=None)
    def google_callback(self, request, payload: SocialCallbackIn):
        """Exchange a Google authorization code for MapLord JWT tokens."""
        # Exchange code for Google tokens
        token_resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": payload.code,
                "grant_type": "authorization_code",
                "redirect_uri": payload.redirect_uri,
            },
            timeout=10,
        )
        if token_resp.status_code != 200:
            raise HttpError(400, "Nie udało się uzyskać tokenu od Google.")

        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HttpError(400, "Brak tokenu dostępu od Google.")

        # Fetch the user's profile
        userinfo_resp = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if userinfo_resp.status_code != 200:
            raise HttpError(400, "Nie udało się pobrać danych użytkownika z Google.")

        userinfo = userinfo_resp.json()
        google_id = userinfo.get("id")
        if not google_id:
            raise HttpError(400, "Brak identyfikatora użytkownika Google.")

        user, is_new = _get_or_create_user(
            provider=SocialAccount.Provider.GOOGLE,
            provider_user_id=google_id,
            email=userinfo.get("email", ""),
            display_name=userinfo.get("name", ""),
            avatar_url=userinfo.get("picture", ""),
        )

        if user.is_banned:
            raise HttpError(403, "Twoje konto zostało zbanowane.")

        tokens = _get_jwt_tokens(user)
        return {**tokens, "is_new_user": is_new}

    # ------------------------------------------------------------------
    # Manage linked accounts (authenticated)
    # ------------------------------------------------------------------

    @route.get(
        "/accounts", response=list[SocialAccountOutSchema], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated]
    )
    def list_accounts(self, request):
        """List all social accounts linked to the current user."""
        return list(request.auth.social_accounts.all())

    @route.post(
        "/google/link", response=SocialAccountOutSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated]
    )
    def google_link(self, request, payload: SocialCallbackIn):
        """Link a Google account to the current user (exchange code first)."""
        token_resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": payload.code,
                "grant_type": "authorization_code",
                "redirect_uri": payload.redirect_uri,
            },
            timeout=10,
        )
        if token_resp.status_code != 200:
            raise HttpError(400, "Nie udało się uzyskać tokenu od Google.")

        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HttpError(400, "Brak tokenu dostępu od Google.")

        userinfo_resp = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if userinfo_resp.status_code != 200:
            raise HttpError(400, "Nie udało się pobrać danych użytkownika z Google.")

        userinfo = userinfo_resp.json()
        google_id = userinfo.get("id")
        if not google_id:
            raise HttpError(400, "Brak identyfikatora użytkownika Google.")

        existing = SocialAccount.objects.filter(
            provider=SocialAccount.Provider.GOOGLE,
            provider_user_id=google_id,
        ).first()
        if existing:
            if existing.user_id == request.auth.id:
                raise HttpError(400, "To konto Google jest już podłączone.")
            raise HttpError(400, "To konto Google jest podłączone do innego użytkownika.")

        return SocialAccount.objects.create(
            user=request.auth,
            provider=SocialAccount.Provider.GOOGLE,
            provider_user_id=google_id,
            email=userinfo.get("email", ""),
            display_name=userinfo.get("name", ""),
            avatar_url=userinfo.get("picture", ""),
        )

    @route.post(
        "/discord/link", response=SocialAccountOutSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated]
    )
    def discord_link(self, request, payload: SocialCallbackIn):
        """Link a Discord account to the current user (exchange code first)."""
        token_resp = requests.post(
            DISCORD_TOKEN_URL,
            data={
                "client_id": settings.DISCORD_CLIENT_ID,
                "client_secret": settings.DISCORD_CLIENT_SECRET,
                "code": payload.code,
                "grant_type": "authorization_code",
                "redirect_uri": payload.redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if token_resp.status_code != 200:
            raise HttpError(400, "Nie udało się uzyskać tokenu od Discord.")

        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HttpError(400, "Brak tokenu dostępu od Discord.")

        userinfo_resp = requests.get(
            DISCORD_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if userinfo_resp.status_code != 200:
            raise HttpError(400, "Nie udało się pobrać danych użytkownika z Discord.")

        userinfo = userinfo_resp.json()
        discord_id = userinfo.get("id")
        if not discord_id:
            raise HttpError(400, "Brak identyfikatora użytkownika Discord.")

        existing = SocialAccount.objects.filter(
            provider=SocialAccount.Provider.DISCORD,
            provider_user_id=discord_id,
        ).first()
        if existing:
            if existing.user_id == request.auth.id:
                raise HttpError(400, "To konto Discord jest już podłączone.")
            raise HttpError(400, "To konto Discord jest podłączone do innego użytkownika.")

        avatar_hash = userinfo.get("avatar", "")
        avatar_url = f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png" if avatar_hash else ""
        display_name = userinfo.get("global_name") or userinfo.get("username", "")

        return SocialAccount.objects.create(
            user=request.auth,
            provider=SocialAccount.Provider.DISCORD,
            provider_user_id=discord_id,
            email=userinfo.get("email", ""),
            display_name=display_name,
            avatar_url=avatar_url,
        )

    @route.delete("/{account_id}/unlink", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def unlink_account(self, request, account_id: str):
        """Unlink a social account from the current user."""
        social = SocialAccount.objects.filter(id=account_id, user=request.auth).first()
        if not social:
            raise HttpError(404, "Nie znaleziono podłączonego konta.")
        social.delete()
        return {"ok": True}

    @route.get("/discord/authorize", response=SocialAuthURLOut, auth=None)
    def discord_authorize(self, request, redirect_uri: str):
        """Return the Discord OAuth2 authorization URL.

        The frontend should redirect the user to the returned URL. After the
        user grants access, Discord redirects back to ``redirect_uri`` with a
        ``code`` query parameter.
        """
        params = {
            "client_id": settings.DISCORD_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "identify email",
            "state": secrets.token_urlsafe(32),
        }
        return {"url": f"{DISCORD_AUTH_URL}?{urlencode(params)}"}

    @route.post("/discord/callback", response=SocialAuthTokenOut, auth=None)
    def discord_callback(self, request, payload: SocialCallbackIn):
        """Exchange a Discord authorization code for MapLord JWT tokens."""
        # Exchange code for Discord tokens
        token_resp = requests.post(
            DISCORD_TOKEN_URL,
            data={
                "client_id": settings.DISCORD_CLIENT_ID,
                "client_secret": settings.DISCORD_CLIENT_SECRET,
                "code": payload.code,
                "grant_type": "authorization_code",
                "redirect_uri": payload.redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if token_resp.status_code != 200:
            raise HttpError(400, "Nie udało się uzyskać tokenu od Discord.")

        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HttpError(400, "Brak tokenu dostępu od Discord.")

        # Fetch the user's profile
        userinfo_resp = requests.get(
            DISCORD_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if userinfo_resp.status_code != 200:
            raise HttpError(400, "Nie udało się pobrać danych użytkownika z Discord.")

        userinfo = userinfo_resp.json()
        discord_id = userinfo.get("id")
        if not discord_id:
            raise HttpError(400, "Brak identyfikatora użytkownika Discord.")

        # Build avatar URL from hash (may be empty for users with no avatar)
        avatar_hash = userinfo.get("avatar", "")
        avatar_url = f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png" if avatar_hash else ""

        username = userinfo.get("username", "")
        display_name = userinfo.get("global_name") or username

        user, is_new = _get_or_create_user(
            provider=SocialAccount.Provider.DISCORD,
            provider_user_id=discord_id,
            email=userinfo.get("email", ""),
            display_name=display_name,
            avatar_url=avatar_url,
        )

        if user.is_banned:
            raise HttpError(403, "Twoje konto zostało zbanowane.")

        tokens = _get_jwt_tokens(user)
        return {**tokens, "is_new_user": is_new}
