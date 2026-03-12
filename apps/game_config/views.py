from typing import List
from ninja_extra import api_controller, route

from apps.game_config.models import GameSettings, BuildingType, UnitType, MapConfig, GameMode
from apps.game_config.schemas import FullConfigOutSchema, GameModeOutSchema, GameModeListSchema


@api_controller('/config', tags=['Config'])
class ConfigController:

    @route.get('/', response=FullConfigOutSchema, auth=None)
    def get_config(self):
        """Returns full public game configuration."""
        settings = GameSettings.get()
        buildings = list(BuildingType.objects.filter(is_active=True))
        units = list(UnitType.objects.filter(is_active=True))
        maps = list(MapConfig.objects.filter(is_active=True))
        game_modes = list(GameMode.objects.filter(is_active=True))
        return {
            'settings': settings,
            'buildings': buildings,
            'units': units,
            'maps': maps,
            'game_modes': game_modes,
        }

    @route.get('/game-modes/', response=List[GameModeListSchema], auth=None)
    def list_game_modes(self):
        """List all active game modes."""
        return list(GameMode.objects.filter(is_active=True))

    @route.get('/game-modes/{slug}/', response=GameModeOutSchema, auth=None)
    def get_game_mode(self, slug: str):
        """Get full details of a game mode."""
        return GameMode.objects.get(slug=slug, is_active=True)
