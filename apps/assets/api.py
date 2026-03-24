from ninja import Schema
from ninja_extra import api_controller, route

from apps.assets.models import GameAsset


class AssetMapSchema(Schema):
    assets: dict[str, str]


@api_controller("/assets", tags=["Assets"])
class AssetController:
    @route.get("/", response=AssetMapSchema, auth=None)
    def get_asset_overrides(self, request):
        """Return all active GameAsset overrides as {key: url} map.

        Excludes assets that are used exclusively as cosmetics (linked to
        cosmetic items) so they don't become global overrides for all players.
        """
        assets = GameAsset.objects.filter(is_active=True).exclude(file="").exclude(cosmetic_items__isnull=False)
        return {"assets": {a.key: a.file.url for a in assets}}
