from typing import List
from ninja_extra import api_controller, route
from django.shortcuts import get_object_or_404

from apps.game_config.models import GameSettings, BuildingType, UnitType, MapConfig, GameMode, AbilityType, GameModule, SystemModule
from apps.game_config.schemas import FullConfigOutSchema, GameModeOutSchema, GameModeListSchema


@api_controller('/config', tags=['Config'])
class ConfigController:

    @route.get('/', response=FullConfigOutSchema, auth=None)
    def get_config(self):
        """Returns full public game configuration."""
        settings = GameSettings.get()
        buildings = list(BuildingType.objects.filter(is_active=True))
        units = list(UnitType.objects.filter(is_active=True))
        abilities = list(AbilityType.objects.filter(is_active=True))
        maps = list(MapConfig.objects.filter(is_active=True))
        game_modes = list(GameMode.objects.filter(is_active=True))
        modules = list(GameModule.objects.filter(is_active=True))
        system_modules = list(SystemModule.objects.all())
        return {
            'settings': settings,
            'buildings': buildings,
            'units': units,
            'abilities': abilities,
            'maps': maps,
            'game_modes': game_modes,
            'modules': modules,
            'system_modules': system_modules,
        }

    @route.get('/game-modes/', response=List[GameModeListSchema], auth=None)
    def list_game_modes(self):
        """List all active game modes."""
        return list(GameMode.objects.filter(is_active=True))

    @route.get('/game-modes/{slug}/', response=GameModeOutSchema, auth=None)
    def get_game_mode(self, slug: str):
        """Get full details of a game mode."""
        return get_object_or_404(GameMode, slug=slug, is_active=True)
