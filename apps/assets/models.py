import uuid

from django.db import models

from apps.utils import resize_image


class AssetCategory(models.TextChoices):
    BUILDING = "building", "Building"
    UNIT = "unit", "Unit"
    ABILITY = "ability", "Ability"
    MUSIC = "music", "Music"
    SOUND = "sound", "Sound Effect"
    ICON = "icon", "Icon"
    TEXTURE = "texture", "Texture"
    ANIMATION = "animation", "Animation"
    OTHER = "other", "Other"


class GameAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.SlugField(
        max_length=150,
        unique=True,
        help_text="Unique key to reference this asset (e.g. matches asset_key in game config)",
    )
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=AssetCategory.choices, default=AssetCategory.OTHER)
    file = models.FileField(upload_to="game_assets/")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "name"]
        verbose_name = "Game Asset"
        verbose_name_plural = "Game Assets"

    IMAGE_EXTENSIONS = (".webp", ".png", ".jpg", ".jpeg", ".gif")
    IMAGE_CATEGORIES = {
        AssetCategory.BUILDING,
        AssetCategory.UNIT,
        AssetCategory.ABILITY,
        AssetCategory.ICON,
        AssetCategory.TEXTURE,
    }

    def __str__(self):
        return f"{self.name} ({self.category})"

    def save(self, *args, **kwargs):
        if (
            self.file
            and self.category in self.IMAGE_CATEGORIES
            and self.file.name.lower().endswith(self.IMAGE_EXTENSIONS)
        ):
            resize_image(self.file, max_size=300)
        super().save(*args, **kwargs)
