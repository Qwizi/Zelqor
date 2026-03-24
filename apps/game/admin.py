from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from apps.game.models import GameStateSnapshot, MatchResult, PlayerResult


class PlayerResultInline(TabularInline):
    model = PlayerResult
    extra = 0
    readonly_fields = (
        "user",
        "placement",
        "regions_conquered",
        "units_produced",
        "units_lost",
        "buildings_built",
        "elo_change",
    )


@admin.register(GameStateSnapshot)
class GameStateSnapshotAdmin(ModelAdmin):
    list_display = ("match", "tick", "created_at")
    list_filter = ("match",)
    list_fullwidth = True
    readonly_fields = ("id", "state_data", "created_at")


@admin.register(MatchResult)
class MatchResultAdmin(ModelAdmin):
    list_display = ("match", "duration_seconds", "total_ticks")
    list_fullwidth = True
    readonly_fields = ("id",)
    inlines = [PlayerResultInline]


@admin.register(PlayerResult)
class PlayerResultAdmin(ModelAdmin):
    list_display = ("user", "match_result", "display_placement", "regions_conquered", "display_elo_change")
    list_filter = ("placement",)
    list_fullwidth = True

    @display(
        description="Placement",
        label={
            1: "success",
            2: "info",
            3: "warning",
        },
    )
    def display_placement(self, obj):
        return obj.placement

    @display(description="ELO Change", ordering="elo_change")
    def display_elo_change(self, obj):
        if obj.elo_change > 0:
            return f"+{obj.elo_change}"
        return str(obj.elo_change)
