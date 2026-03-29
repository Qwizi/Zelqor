import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from ninja import Schema
from ninja.errors import HttpError
from ninja_extra import api_controller, route

from apps.accounts.social_auth import _get_jwt_tokens, _get_or_create_user
from apps.game_config.decorators import require_module_controller

User = get_user_model()

STEAM_VERIFY_URL = "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/"
STEAM_PLAYER_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"


class SteamAuthIn(Schema):
    ticket: str  # Hex-encoded auth ticket from desktop client


class SteamAuthTokenOut(Schema):
    access: str
    refresh: str
    is_new_user: bool


@api_controller("/auth/steam", tags=["Steam Auth"])
@require_module_controller("steam-auth")
class SteamAuthController:
    @route.post("/authenticate", response=SteamAuthTokenOut, auth=None)
    def authenticate(self, request, payload: SteamAuthIn):
        """Authenticate a Steam user via encrypted app ticket.

        The desktop (Tauri) client sends a hex-encoded auth ticket obtained
        from the Steamworks SDK. This endpoint:
        1. Verifies the ticket with Steam Web API
        2. Fetches the player's Steam profile
        3. Returns Zelqor JWT tokens (creating account if needed)
        """
        steam_api_key = getattr(settings, "STEAM_WEB_API_KEY", "")
        steam_app_id = getattr(settings, "STEAM_APP_ID", "480")

        if not steam_api_key:
            raise HttpError(503, "Steam authentication is not configured.")

        # 1. Verify the ticket with Steam
        verify_resp = requests.get(
            STEAM_VERIFY_URL,
            params={
                "key": steam_api_key,
                "appid": steam_app_id,
                "ticket": payload.ticket,
            },
            timeout=10,
        )
        if verify_resp.status_code != 200:
            raise HttpError(400, "Nie udało się zweryfikować biletu Steam.")

        verify_data = verify_resp.json()
        params = verify_data.get("response", {}).get("params", {})
        result = params.get("result", "error")
        steam_id = params.get("steamid", "")

        if result != "OK" or not steam_id:
            raise HttpError(401, "Bilet Steam jest nieprawidłowy lub wygasł.")

        # 2. Fetch player profile from Steam
        profile_resp = requests.get(
            STEAM_PLAYER_URL,
            params={
                "key": steam_api_key,
                "steamids": steam_id,
            },
            timeout=10,
        )
        display_name = ""
        avatar_url = ""
        if profile_resp.status_code == 200:
            players = profile_resp.json().get("response", {}).get("players", [])
            if players:
                player = players[0]
                display_name = player.get("personaname", "")
                avatar_url = player.get("avatarfull", "")

        # 3. Get or create Zelqor user
        user, is_new = _get_or_create_user(
            provider="steam",
            provider_user_id=steam_id,
            email="",  # Steam doesn't share email
            display_name=display_name,
            avatar_url=avatar_url,
        )

        if user.is_banned:
            raise HttpError(403, "Twoje konto zostało zbanowane.")

        tokens = _get_jwt_tokens(user)
        return {**tokens, "is_new_user": is_new}
