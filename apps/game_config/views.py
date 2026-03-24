from django.shortcuts import get_object_or_404
from ninja_extra import api_controller, route

from apps.game_config.models import AbilityType, BuildingType, GameMode, GameSettings, MapConfig, SystemModule, UnitType
from apps.game_config.schemas import FullConfigOutSchema, GameModeListSchema, GameModeOutSchema


@api_controller("/config", tags=["Config"])
class ConfigController:
    @route.get("/", response=FullConfigOutSchema, auth=None)
    def get_config(self):
        """Returns full public game configuration."""
        settings = GameSettings.get()
        buildings = list(BuildingType.objects.filter(is_active=True))
        units = list(UnitType.objects.filter(is_active=True))
        abilities = list(AbilityType.objects.filter(is_active=True))
        maps = list(MapConfig.objects.filter(is_active=True))
        game_modes = list(GameMode.objects.filter(is_active=True))
        all_modules = list(SystemModule.objects.all())
        game_modules = [m for m in all_modules if m.module_type == "game" and m.enabled]
        return {
            "settings": settings,
            "buildings": buildings,
            "units": units,
            "abilities": abilities,
            "maps": maps,
            "game_modes": game_modes,
            "modules": game_modules,
            "system_modules": all_modules,
        }

    @route.get("/game-modes/", response=list[GameModeListSchema], auth=None)
    def list_game_modes(self):
        """List all active game modes."""
        return list(GameMode.objects.filter(is_active=True))

    @route.get("/game-modes/{slug}/", response=GameModeOutSchema, auth=None)
    def get_game_mode(self, slug: str):
        """Get full details of a game mode."""
        return get_object_or_404(GameMode, slug=slug, is_active=True)
