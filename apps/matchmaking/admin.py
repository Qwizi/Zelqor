from django.contrib import admin
from django.db.models import Count
from django.http import HttpRequest
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display
from apps.matchmaking.models import Lobby, LobbyPlayer, Match, MatchPlayer, MatchQueue


class MatchPlayerInline(TabularInline):
    model = MatchPlayer
    extra = 0
    readonly_fields = ('user', 'color', 'is_alive', 'capital_region', 'joined_at', 'eliminated_at')


@admin.register(Match)
class MatchAdmin(ModelAdmin):
    list_display = ('id', 'display_status', 'max_players', 'player_count', 'winner', 'started_at', 'finished_at')
    list_filter = ('status',)
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ('id',)
    readonly_fields = ('id', 'settings_snapshot', 'created_at')
    warn_unsaved_form = True
    inlines = [MatchPlayerInline]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(player_count=Count('players'))

    def player_count(self, obj):
        return obj.player_count
    player_count.short_description = 'Players'

    @display(description="Status", label={
        "waiting": "info",
        "selecting": "warning",
        "in_progress": "primary",
        "finished": "success",
        "cancelled": "danger",
    })
    def display_status(self, obj):
        return obj.status

    def cancel_match_action(self, request, queryset):
        import redis
        from django.conf import settings
        redis_url = f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_GAME_DB}"
        r = redis.Redis.from_url(redis_url)
        count = 0
        for match in queryset.filter(status__in=['selecting', 'in_progress']):
            r.set(f"game:{match.id}:cancel_requested", "1", ex=300)
            match.status = 'cancelled'
            match.save(update_fields=['status'])
            count += 1
        self.message_user(request, f"Anulowano {count} meczy.")
    cancel_match_action.short_description = "Anuluj wybrane mecze (powiadom graczy)"

    actions = [cancel_match_action]


@admin.register(MatchPlayer)
class MatchPlayerAdmin(ModelAdmin):
    list_display = ('user', 'match', 'color', 'display_alive', 'joined_at')
    list_filter = ('is_alive',)
    list_fullwidth = True

    @display(description="Alive", label=True)
    def display_alive(self, obj):
        return "ALIVE" if obj.is_alive else "DEAD"


@admin.register(MatchQueue)
class MatchQueueAdmin(ModelAdmin):
    list_display = ('user', 'joined_at')
    list_fullwidth = True
    readonly_fields = ('id',)


class LobbyPlayerInline(TabularInline):
    model = LobbyPlayer
    extra = 0
    readonly_fields = ('user', 'is_ready', 'is_bot', 'joined_at')


@admin.register(Lobby)
class LobbyAdmin(ModelAdmin):
    list_display = ('id', 'display_status', 'max_players', 'host_user', 'created_at')
    list_filter = ('status',)
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ('id',)
    readonly_fields = ('id', 'created_at')
    inlines = [LobbyPlayerInline]

    @display(description="Status", label={
        "waiting": "info",
        "full": "warning",
        "ready": "primary",
        "starting": "success",
        "cancelled": "danger",
    })
    def display_status(self, obj):
        return obj.status


@admin.register(LobbyPlayer)
class LobbyPlayerAdmin(ModelAdmin):
    list_display = ('user', 'lobby', 'is_ready', 'is_bot', 'joined_at')
    list_filter = ('is_ready', 'is_bot')
    list_fullwidth = True
