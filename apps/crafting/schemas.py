import uuid
from datetime import datetime

from ninja import Schema

from apps.inventory.schemas import ItemOutSchema


class RecipeIngredientOutSchema(Schema):
    item: ItemOutSchema
    quantity: int

    class Config:
        from_attributes = True


class RecipeOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    result_item: ItemOutSchema
    result_quantity: int
    gold_cost: int
    crafting_time_seconds: int
    ingredients: list[RecipeIngredientOutSchema] = []

    class Config:
        from_attributes = True


class CraftInSchema(Schema):
    recipe_slug: str


class CraftingLogOutSchema(Schema):
    id: uuid.UUID
    recipe_name: str
    result_item: ItemOutSchema
    result_quantity: int
    gold_spent: int
    created_at: datetime

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_recipe_name(obj):
        return obj.recipe.name
