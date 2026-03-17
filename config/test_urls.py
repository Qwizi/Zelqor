"""
Test URL configuration — skips apps.geo which requires GDAL/PostGIS.
"""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from ninja_extra import NinjaExtraAPI
from ninja_jwt.controller import NinjaJWTDefaultController

from apps.accounts.views import AuthController
from apps.game_config.views import ConfigController
from apps.matchmaking.views import MatchController, TutorialController
from apps.game.views import GameController, ShareController
from apps.shop.views import ShopController
from apps.inventory.views import DeckController, InventoryController
from apps.marketplace.views import MarketplaceController
from apps.crafting.views import CraftingController
from apps.game.internal_api import GameInternalController
from apps.matchmaking.internal_api import LobbyInternalController, MatchmakingInternalController
from apps.chat.internal_api import ChatInternalController
from apps.developers.views import DeveloperController
from apps.developers.public_views import PublicAPIController
from apps.developers.oauth_views import OAuthController
from apps.assets.api import AssetController

api = NinjaExtraAPI(title='MapLord API', version='1.0.0')
api.register_controllers(
    NinjaJWTDefaultController,
    AuthController,
    ConfigController,
    MatchController,
    TutorialController,
    GameController,
    ShareController,
    ShopController,
    InventoryController,
    DeckController,
    MarketplaceController,
    CraftingController,
    GameInternalController,
    MatchmakingInternalController,
    LobbyInternalController,
    ChatInternalController,
    DeveloperController,
    PublicAPIController,
    OAuthController,
    AssetController,
)


def health_check(request):
    from django.http import JsonResponse
    from django.db import connection
    try:
        connection.ensure_connection()
    except Exception:
        return JsonResponse({'status': 'error', 'db': False}, status=503)
    return JsonResponse({'status': 'ok', 'db': True})


urlpatterns = [
    path('health/', health_check),
    path('admin/', admin.site.urls),
    path('api/v1/', api.urls),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
