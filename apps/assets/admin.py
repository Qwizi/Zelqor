from django.contrib import admin
from django.utils.html import format_html
from django.utils.safestring import mark_safe
from unfold.admin import ModelAdmin
from unfold.decorators import display

from apps.assets.models import GameAsset


def _get_available_keys():
    """Collect all overridable asset keys from registry + game config."""
    from apps.assets.registry import WELL_KNOWN_ASSETS
    from apps.game_config.models import AbilityType, BuildingType, UnitType

    existing = set(GameAsset.objects.values_list("key", flat=True))
    keys = []
    seen = set()

    # Well-known frontend assets
    for category, key, description in WELL_KNOWN_ASSETS:
        keys.append((category, key, description, key in existing))
        seen.add(key)

    # Dynamic keys from game config (not already in registry)
    for b in BuildingType.objects.filter(is_active=True).order_by("name"):
        if b.asset_key and b.asset_key not in seen:
            keys.append(("building", b.asset_key, f"{b.name} (game config)", b.asset_key in existing))
            seen.add(b.asset_key)
    for u in UnitType.objects.filter(is_active=True).order_by("name"):
        if u.asset_key and u.asset_key not in seen:
            keys.append(("unit", u.asset_key, f"{u.name} (game config)", u.asset_key in existing))
            seen.add(u.asset_key)
    for a in AbilityType.objects.filter(is_active=True).order_by("name"):
        if a.asset_key and a.asset_key not in seen:
            keys.append(("ability", a.asset_key, f"{a.name} (game config)", a.asset_key in existing))
            seen.add(a.asset_key)
        if a.sound_key and a.sound_key not in seen:
            keys.append(("sound", a.sound_key, f"{a.name} sound (game config)", a.sound_key in existing))
            seen.add(a.sound_key)

    return keys


@admin.register(GameAsset)
class GameAssetAdmin(ModelAdmin):
    list_display = ("preview", "name", "key", "category", "display_active", "updated_at")
    list_filter = ("category", "is_active")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "key")
    readonly_fields = ("preview_large", "available_keys")
    warn_unsaved_form = True
    fieldsets = (
        (None, {"fields": ("name", "key", "category", "file", "preview_large", "description", "is_active")}),
        (
            "Available asset keys from Game Config",
            {
                "fields": ("available_keys",),
                "classes": ("collapse",),
                "description": "Keys that can be used to override frontend defaults. Green = already has a GameAsset, red = missing.",
            },
        ),
    )

    def preview(self, obj):
        if obj.file and obj.file.name.lower().endswith((".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg")):
            return format_html(
                '<img src="{}" style="max-height:40px;max-width:60px;object-fit:contain;" />', obj.file.url
            )
        return obj.file.name.split("/")[-1] if obj.file else "-"

    preview.short_description = "Preview"

    def preview_large(self, obj):
        if obj.file and obj.file.name.lower().endswith((".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg")):
            return format_html(
                '<img src="{}" style="max-height:200px;max-width:300px;object-fit:contain;" />', obj.file.url
            )
        return obj.file.name if obj.file else "-"

    preview_large.short_description = "Preview"

    def available_keys(self, obj=None):
        keys = _get_available_keys()
        if not keys:
            return "No asset keys found in game config."
        html = '<div style="line-height:2">'
        for category, key, name, exists in keys:
            color = "#22c55e" if exists else "#ef4444"
            status = "✓" if exists else "✗"
            html += format_html(
                '<span style="color:{};font-weight:600">{}</span> '
                '<code style="background:#1e293b;padding:2px 6px;border-radius:4px">{}</code> '
                '<span style="color:#94a3b8">({} — {})</span><br>',
                color,
                status,
                key,
                category,
                name,
            )
        html += "</div>"
        return mark_safe(html)

    available_keys.short_description = "Asset keys from Game Config"

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"
