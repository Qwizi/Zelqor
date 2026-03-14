from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from ninja_extra import NinjaExtraAPI
from ninja_jwt.controller import NinjaJWTDefaultController

from apps.accounts.views import AuthController
from apps.geo.views import GeoController
from apps.game_config.views import ConfigController
from apps.matchmaking.views import MatchController, TutorialController
from apps.game.views import GameController, ShareController
from apps.shop.views import ShopController
from apps.inventory.views import DeckController, InventoryController
from apps.marketplace.views import MarketplaceController
from apps.crafting.views import CraftingController
from apps.game.internal_api import GameInternalController
from apps.matchmaking.internal_api import MatchmakingInternalController
from apps.chat.internal_api import ChatInternalController
from apps.developers.views import DeveloperController
from apps.developers.public_views import PublicAPIController
from apps.developers.oauth_views import OAuthController

api = NinjaExtraAPI(title='MapLord API', version='1.0.0')
api.register_controllers(
    NinjaJWTDefaultController,
    AuthController,
    GeoController,
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
    ChatInternalController,
    DeveloperController,
    PublicAPIController,
    OAuthController,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', api.urls),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
