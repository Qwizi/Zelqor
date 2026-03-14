import uuid
from django.conf import settings
from django.db import models


class Recipe(models.Model):
    """A crafting recipe that defines what items are needed and what is produced."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    result_item = models.ForeignKey(
        'inventory.Item', on_delete=models.CASCADE,
        related_name='produced_by_recipes',
    )
    result_quantity = models.PositiveIntegerField(default=1)
    gold_cost = models.PositiveIntegerField(default=0, help_text='Gold required to craft')
    crafting_time_seconds = models.PositiveIntegerField(default=0, help_text='0 = instant')
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return f'{self.name} -> {self.result_item.name} x{self.result_quantity}'


class RecipeIngredient(models.Model):
    """An ingredient required for a recipe."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name='ingredients')
    item = models.ForeignKey(
        'inventory.Item', on_delete=models.CASCADE,
        related_name='used_in_recipes',
    )
    quantity = models.PositiveIntegerField(default=1)

    class Meta:
        unique_together = ('recipe', 'item')
        ordering = ['item__name']

    def __str__(self):
        return f'{self.item.name} x{self.quantity} for {self.recipe.name}'


class CraftingLog(models.Model):
    """Record of a completed crafting action."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='crafting_logs')
    recipe = models.ForeignKey(Recipe, on_delete=models.CASCADE, related_name='crafting_logs')
    result_item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE)
    result_quantity = models.PositiveIntegerField()
    gold_spent = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username} crafted {self.result_item.name} x{self.result_quantity}'
