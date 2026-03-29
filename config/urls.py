from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path
from ninja_extra import NinjaExtraAPI
from ninja_jwt.controller import NinjaJWTDefaultController

from apps.accounts.friends_api import FriendsController
from apps.accounts.messages_api import MessagesController
from apps.accounts.social_auth import SocialAuthController
from apps.accounts.steam_auth import SteamAuthController
from apps.accounts.views import AuthController
from apps.assets.api import AssetController
from apps.chat.internal_api import ChatInternalController
from apps.clans.api import ClanController, ClanGlobalController
from apps.crafting.views import CraftingController
from apps.developers.oauth_views import OAuthController
from apps.developers.public_views import PublicAPIController
from apps.developers.views import CommunityServerController, DeveloperController, PluginController
from apps.game.internal_api import GameInternalController
from apps.game.views import GameController, ShareController
from apps.game_config.views import ConfigController
from apps.geo.views import GeoController
from apps.inventory.views import DeckController, InventoryController
from apps.marketplace.views import MarketplaceController
from apps.matchmaking.internal_api import LobbyInternalController, MatchmakingInternalController
from apps.matchmaking.views import MatchController, MatchmakingStatusController, TutorialController
from apps.notifications.views import NotificationController
from apps.payments.views import PaymentsController, PaymentsWebhookController

api = NinjaExtraAPI(title="Zelqor API", version="1.0.0")
api.register_controllers(
    NinjaJWTDefaultController,
    AuthController,
    GeoController,
    ConfigController,
    MatchController,
    TutorialController,
    MatchmakingStatusController,
    GameController,
    ShareController,
    InventoryController,
    DeckController,
    MarketplaceController,
    CraftingController,
    GameInternalController,
    MatchmakingInternalController,
    LobbyInternalController,
    ChatInternalController,
    DeveloperController,
    CommunityServerController,
    PluginController,
    PublicAPIController,
    OAuthController,
    AssetController,
    SocialAuthController,
    SteamAuthController,
    FriendsController,
    MessagesController,
    NotificationController,
    ClanGlobalController,
    ClanController,
    PaymentsController,
    PaymentsWebhookController,
)


def health_check(request):
    from django.db import connection
    from django.http import JsonResponse

    try:
        connection.ensure_connection()
    except Exception:
        return JsonResponse({"status": "error", "db": False}, status=503)
    return JsonResponse({"status": "ok", "db": True})


urlpatterns = [
    path("health/", health_check),
    path("admin/", admin.site.urls),
    path("api/v1/", api.urls),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
