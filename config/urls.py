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
from apps.game.views import GameController
from apps.shop.views import ShopController
from apps.game.internal_api import GameInternalController
from apps.matchmaking.internal_api import MatchmakingInternalController

api = NinjaExtraAPI(title='MapLord API', version='1.0.0')
api.register_controllers(
    NinjaJWTDefaultController,
    AuthController,
    GeoController,
    ConfigController,
    MatchController,
    TutorialController,
    GameController,
    ShopController,
    GameInternalController,
    MatchmakingInternalController,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', api.urls),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
