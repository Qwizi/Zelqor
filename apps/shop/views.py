from typing import List
from ninja_extra import api_controller, route

from apps.shop.models import ShopCategory
from apps.shop.schemas import ShopCategoryOutSchema
from apps.game_config.decorators import require_module_controller


@api_controller('/shop', tags=['Shop'])
@require_module_controller('shop')
class ShopController:

    @route.get('/', response=List[ShopCategoryOutSchema], auth=None)
    def list_shop(self):
        return list(
            ShopCategory.objects.filter(is_active=True)
            .prefetch_related('items')
        )
