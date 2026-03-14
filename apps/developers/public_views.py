from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from ninja.errors import HttpError
from ninja_extra import api_controller, route

from apps.developers.auth import APIKeyAuth, check_scope
from apps.developers.schemas import (
    PublicLeaderboardEntrySchema,
    PublicMatchDetailSchema,
    PublicMatchOutSchema,
    PublicPlayerStatsSchema,
)
from apps.game.models import GameStateSnapshot, MatchResult, PlayerResult
from apps.game_config.models import AbilityType, BuildingType, GameMode, GameSettings, MapConfig, UnitType
from apps.game_config.schemas import FullConfigOutSchema
from apps.matchmaking.models import Match, MatchPlayer

User = get_user_model()


@api_controller('/public', tags=['Public API'], auth=APIKeyAuth())
class PublicAPIController:

    @route.get('/leaderboard/', response=dict)
    def get_leaderboard(self, request, page: int = 1, per_page: int = 20):
        """Paginated leaderboard of non-bot active players ordered by ELO rating."""
        if not check_scope(request, 'leaderboard:read'):
            raise HttpError(403, 'Insufficient scope: leaderboard:read')

        per_page = min(per_page, 100)
        queryset = User.objects.filter(is_bot=False, is_active=True).order_by('-elo_rating')

        total = queryset.count()
        users = queryset[(page - 1) * per_page: page * per_page]

        items = [
            PublicLeaderboardEntrySchema(
                user_id=user.id,
                username=user.username,
                elo_rating=user.elo_rating,
                avatar=str(user.avatar.url) if user.avatar else None,
            )
            for user in users
        ]

        return {
            'items': [item.model_dump() for item in items],
            'total': total,
            'page': page,
            'per_page': per_page,
        }

    @route.get('/matches/', response=dict)
    def list_matches(self, request, page: int = 1, per_page: int = 20):
        """Paginated list of finished non-tutorial matches."""
        if not check_scope(request, 'matches:read'):
            raise HttpError(403, 'Insufficient scope: matches:read')

        per_page = min(per_page, 100)
        queryset = Match.objects.filter(status='finished', is_tutorial=False).order_by('-created_at')

        total = queryset.count()
        matches = queryset[(page - 1) * per_page: page * per_page]

        items = [
            PublicMatchOutSchema.model_validate(match)
            for match in matches
        ]

        return {
            'items': [item.model_dump() for item in items],
            'total': total,
            'page': page,
            'per_page': per_page,
        }

    @route.get('/matches/{match_id}/', response=Any)
    def get_match(self, request, match_id: str):
        """Finished match detail including players and winner information."""
        if not check_scope(request, 'matches:read'):
            raise HttpError(403, 'Insufficient scope: matches:read')

        match = get_object_or_404(
            Match.objects.prefetch_related('players', 'players__user'),
            id=match_id,
            status='finished',
        )

        players = [
            {
                'user_id': str(mp.user.id),
                'username': mp.user.username,
                'color': mp.color,
                'is_alive': mp.is_alive,
            }
            for mp in match.players.all()
        ]

        winner_username: str | None = None
        duration_ticks: int | None = None

        try:
            result = MatchResult.objects.get(match_id=match.id)
            duration_ticks = result.total_ticks
            if match.winner_id:
                winner_player = match.players.filter(user_id=match.winner_id).first()
                if winner_player:
                    winner_username = winner_player.user.username
        except MatchResult.DoesNotExist:
            if match.winner_id:
                winner_player = match.players.filter(user_id=match.winner_id).first()
                if winner_player:
                    winner_username = winner_player.user.username

        detail = PublicMatchDetailSchema(
            id=match.id,
            status=match.status,
            max_players=match.max_players,
            created_at=match.created_at,
            players=players,
            winner_username=winner_username,
            duration_ticks=duration_ticks,
        )

        return detail.model_dump()

    @route.get('/matches/{match_id}/snapshots/', response=list[int])
    def list_snapshots(self, request, match_id: str):
        """List of available snapshot tick numbers for a finished match."""
        if not check_scope(request, 'matches:read'):
            raise HttpError(403, 'Insufficient scope: matches:read')

        get_object_or_404(Match, id=match_id, status='finished')

        ticks = list(
            GameStateSnapshot.objects.filter(match_id=match_id)
            .order_by('tick')
            .values_list('tick', flat=True)
        )
        return ticks

    @route.get('/matches/{match_id}/snapshots/{tick}/', response=Any)
    def get_snapshot(self, request, match_id: str, tick: int):
        """Full state data for a specific snapshot tick of a finished match."""
        if not check_scope(request, 'matches:read'):
            raise HttpError(403, 'Insufficient scope: matches:read')

        get_object_or_404(Match, id=match_id, status='finished')
        snapshot = get_object_or_404(GameStateSnapshot, match_id=match_id, tick=tick)
        return snapshot.state_data

    @route.get('/players/{player_id}/stats/', response=Any)
    def get_player_stats(self, request, player_id: str):
        """Aggregated statistics for a player including match count, wins, and ELO."""
        if not check_scope(request, 'players:read'):
            raise HttpError(403, 'Insufficient scope: players:read')

        user = get_object_or_404(User, id=player_id)

        agg = PlayerResult.objects.filter(user_id=user.id).aggregate(
            matches_played=Count('id'),
            wins=Count('id', filter=Q(placement=1)),
            avg_placement=Avg('placement'),
        )

        matches_played = int(agg['matches_played'] or 0)
        wins = int(agg['wins'] or 0)
        win_rate = (wins / matches_played) if matches_played > 0 else 0.0
        avg_placement = float(agg['avg_placement']) if agg['avg_placement'] is not None else None

        stats = PublicPlayerStatsSchema(
            user_id=user.id,
            username=user.username,
            elo_rating=user.elo_rating,
            avatar=str(user.avatar.url) if user.avatar else None,
            matches_played=matches_played,
            wins=wins,
            win_rate=win_rate,
            avg_placement=avg_placement,
        )

        return stats.model_dump()

    @route.get('/config/', response=FullConfigOutSchema)
    def get_config(self, request):
        """Full public game configuration including buildings, units, abilities, maps, and game modes."""
        if not check_scope(request, 'config:read'):
            raise HttpError(403, 'Insufficient scope: config:read')

        settings = GameSettings.get()
        buildings = list(BuildingType.objects.filter(is_active=True))
        units = list(UnitType.objects.filter(is_active=True))
        abilities = list(AbilityType.objects.filter(is_active=True))
        maps = list(MapConfig.objects.filter(is_active=True))
        game_modes = list(GameMode.objects.filter(is_active=True))

        return {
            'settings': settings,
            'buildings': buildings,
            'units': units,
            'abilities': abilities,
            'maps': maps,
            'game_modes': game_modes,
        }
