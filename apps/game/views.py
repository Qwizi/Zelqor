from typing import List, Optional

from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from apps.accounts.auth import ActiveUserJWTAuth
from django.shortcuts import get_object_or_404
from apps.game_config.decorators import require_module_controller

from apps.game.models import GameStateSnapshot, MatchResult, ShareLink
from apps.game.schemas import (
    MatchResultOutSchema,
    SnapshotDetailSchema,
    SnapshotTickSchema,
    CreateShareSchema,
    ShareLinkOutSchema,
    SharedResourceSchema,
    SharedSnapshotSchema,
)


@api_controller('/game', tags=['Game'])
@require_module_controller('matchmaking')
class GameController:

    @route.get('/results/{match_id}/', response=MatchResultOutSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def get_result(self, request, match_id: str):
        return get_object_or_404(
            MatchResult.objects.prefetch_related('player_results', 'player_results__user'),
            match_id=match_id,
        )

    @route.get('/snapshots/{match_id}/', response=List[SnapshotTickSchema], auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def list_snapshots(self, request, match_id: str):
        """List available snapshot ticks for a match (for replay timeline)."""
        return list(
            GameStateSnapshot.objects.filter(match_id=match_id)
            .order_by('tick')
            .values('tick', 'created_at')
        )

    @route.get('/snapshots/{match_id}/{tick}/', response=SnapshotDetailSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def get_snapshot(self, request, match_id: str, tick: int):
        """Get a single snapshot with full state data."""
        return get_object_or_404(GameStateSnapshot, match_id=match_id, tick=tick)


@api_controller('/share', tags=['Share'])
@require_module_controller('replay')
class ShareController:

    @route.post('/create/', response=ShareLinkOutSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def create_share_link(self, request, body: CreateShareSchema):
        """Create a share link for a resource. Returns existing link if one already exists."""
        from apps.matchmaking.models import Match

        if body.resource_type == 'match_result':
            if not Match.objects.filter(id=body.resource_id, status='finished').exists():
                return self.create_response(
                    {'detail': 'Match not found or not finished'},
                    status_code=404,
                )
        else:
            return self.create_response(
                {'detail': f'Unknown resource type: {body.resource_type}'},
                status_code=400,
            )

        link, _created = ShareLink.objects.get_or_create(
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            defaults={
                'token': ShareLink.generate_token(),
                'created_by': request.auth,
            },
        )
        return ShareLinkOutSchema(
            token=link.token,
            resource_type=link.resource_type,
            resource_id=str(link.resource_id),
        )

    @route.get('/{token}/', response=SharedResourceSchema, auth=None)
    def get_shared_resource(self, request, token: str):
        """Public endpoint — returns shared resource data without authentication."""
        link = get_object_or_404(ShareLink, token=token)

        if link.resource_type == 'match_result':
            return self._get_match_result_data(link.resource_id)

        return self.create_response(
            {'detail': 'Unknown resource type'},
            status_code=400,
        )

    @route.get('/{token}/snapshots/{tick}/', response=SharedSnapshotSchema, auth=None)
    def get_shared_snapshot(self, request, token: str, tick: int):
        """Public endpoint — returns a single snapshot for a shared match."""
        link = get_object_or_404(ShareLink, token=token)

        if link.resource_type != 'match_result':
            return self.create_response(
                {'detail': 'Not a match share'},
                status_code=400,
            )

        snapshot = get_object_or_404(GameStateSnapshot, match_id=link.resource_id, tick=tick)
        return SharedSnapshotSchema(tick=snapshot.tick, state_data=snapshot.state_data)

    def _get_match_result_data(self, match_id) -> dict:
        """Assemble match + result + snapshot tick list for public viewing."""
        from apps.matchmaking.models import Match

        match = get_object_or_404(
            Match.objects.prefetch_related('players', 'players__user'),
            id=match_id,
        )

        match_data = {
            'id': str(match.id),
            'status': match.status,
            'max_players': match.max_players,
            'winner_id': str(match.winner_id) if match.winner_id else None,
            'started_at': match.started_at,
            'finished_at': match.finished_at,
            'created_at': match.created_at,
            'players': [
                {
                    'id': str(p.id),
                    'user_id': str(p.user.id),
                    'username': p.user.username,
                    'color': p.color,
                    'is_alive': p.is_alive,
                    'joined_at': p.joined_at,
                }
                for p in match.players.all()
            ],
        }

        result_data: Optional[dict] = None
        try:
            match_result = MatchResult.objects.prefetch_related(
                'player_results', 'player_results__user'
            ).get(match_id=match_id)
            result_data = {
                'id': str(match_result.id),
                'match_id': str(match_result.match_id),
                'duration_seconds': match_result.duration_seconds,
                'total_ticks': match_result.total_ticks,
                'player_results': [
                    {
                        'user_id': str(pr.user_id),
                        'username': pr.user.username,
                        'placement': pr.placement,
                        'regions_conquered': pr.regions_conquered,
                        'units_produced': pr.units_produced,
                        'units_lost': pr.units_lost,
                        'buildings_built': pr.buildings_built,
                        'elo_change': pr.elo_change,
                    }
                    for pr in match_result.player_results.all()
                ],
            }
        except MatchResult.DoesNotExist:
            pass

        snapshot_ticks = list(
            GameStateSnapshot.objects.filter(match_id=match_id)
            .order_by('tick')
            .values_list('tick', flat=True)
        )

        return {
            'resource_type': 'match_result',
            'match': match_data,
            'result': result_data,
            'snapshot_ticks': snapshot_ticks,
        }
