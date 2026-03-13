import logging

from ninja_extra import ControllerBase, api_controller, route
from ninja import Schema
from pydantic import Field

from apps.internal_auth import check_internal_secret

logger = logging.getLogger(__name__)


# --- Schemas ---


class SnapshotRequest(Schema):
    match_id: str
    tick: int
    state_data: dict


class FinalizeRequest(Schema):
    match_id: str
    winner_id: str | None = None
    total_ticks: int
    final_state: dict


class CleanupRequest(Schema):
    match_id: str


class StatusUpdateRequest(Schema):
    status: str


class AliveUpdateRequest(Schema):
    is_alive: bool


# --- Controller ---


@api_controller('/internal', tags=['internal'])
class GameInternalController(ControllerBase):
    """Internal API for the Rust gateway — game-related endpoints."""

    @route.post('/game/snapshot/')
    def save_snapshot(self, request, body: SnapshotRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.game.models import GameStateSnapshot
        GameStateSnapshot.objects.update_or_create(
            match_id=body.match_id,
            tick=body.tick,
            defaults={"state_data": body.state_data},
        )
        return {'ok': True}

    @route.get('/game/latest-snapshot/{match_id}/')
    def get_latest_snapshot(self, request, match_id: str):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.game.models import GameStateSnapshot
        snapshot = GameStateSnapshot.objects.filter(match_id=match_id).order_by('-tick').first()
        if snapshot:
            return {'tick': snapshot.tick, 'state_data': snapshot.state_data}
        return {'tick': None, 'state_data': None}

    @route.post('/game/finalize/')
    def finalize_match(self, request, body: FinalizeRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.game.tasks import finalize_match_results_sync
        finalize_match_results_sync(
            body.match_id,
            body.winner_id,
            body.total_ticks,
            body.final_state,
        )
        return {'ok': True}

    @route.post('/game/cleanup/')
    def cleanup_match(self, request, body: CleanupRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.game.tasks import cleanup_redis_game_state
        cleanup_redis_game_state.delay(body.match_id)
        return {'ok': True}

    @route.get('/users/{user_id}/')
    def get_user(self, request, user_id: str):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.accounts.models import User
        try:
            user = User.objects.get(id=user_id)
            return {
                'id': str(user.id),
                'username': user.username,
                'elo_rating': user.elo_rating,
            }
        except User.DoesNotExist:
            return self.create_response(request, {'error': 'User not found'}, status_code=404)

    @route.get('/matches/{match_id}/verify-player/{user_id}/')
    def verify_player(self, request, match_id: str, user_id: str):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.matchmaking.models import MatchPlayer
        is_member = MatchPlayer.objects.filter(match_id=match_id, user_id=user_id).exists()
        return {'is_member': is_member}

    @route.get('/matches/{match_id}/data/')
    def get_match_data(self, request, match_id: str):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.matchmaking.models import Match
        try:
            match = Match.objects.prefetch_related('players__user').get(id=match_id)
            return {
                'max_players': match.max_players,
                'is_tutorial': match.is_tutorial,
                'settings_snapshot': match.settings_snapshot,
                'players': [
                    {
                        'user_id': str(p.user.id),
                        'username': p.user.username,
                        'color': p.color,
                        'is_bot': p.user.is_bot,
                    }
                    for p in match.players.all()
                ],
            }
        except Match.DoesNotExist:
            return self.create_response(request, {'error': 'Match not found'}, status_code=404)

    @route.get('/matches/{match_id}/regions/')
    def get_match_regions(self, request, match_id: str):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.geo.models import Region
        from apps.matchmaking.models import Match

        try:
            match = Match.objects.select_related('map_config').get(id=match_id)
        except Match.DoesNotExist:
            return self.create_response(request, {'error': 'Match not found'}, status_code=404)

        qs = Region.objects.select_related('country')
        if match.map_config and match.map_config.country_codes:
            qs = qs.filter(country__code__in=match.map_config.country_codes)

        return {
            str(r.id): {
                'id': str(r.id),
                'name': r.name,
                'country_code': r.country.code,
                'centroid': [float(r.centroid.x), float(r.centroid.y)] if r.centroid else None,
                'is_coastal': r.is_coastal,
                'sea_distances': r.sea_distances or [],
            }
            for r in qs
        }

    @route.patch('/matches/{match_id}/status/')
    def update_match_status(self, request, match_id: str, body: StatusUpdateRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.matchmaking.models import Match
        updated = Match.objects.filter(id=match_id).update(status=body.status)
        if not updated:
            return self.create_response(request, {'error': 'Match not found'}, status_code=404)
        return {'ok': True}

    @route.patch('/matches/{match_id}/players/{user_id}/alive/')
    def set_player_alive(self, request, match_id: str, user_id: str, body: AliveUpdateRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from django.utils import timezone
        from apps.matchmaking.models import MatchPlayer

        updates = {'is_alive': body.is_alive}
        if not body.is_alive:
            updates['eliminated_at'] = timezone.now()
        else:
            updates['eliminated_at'] = None

        updated = MatchPlayer.objects.filter(
            match_id=match_id, user_id=user_id
        ).update(**updates)
        if not updated:
            return self.create_response(request, {'error': 'MatchPlayer not found'}, status_code=404)
        return {'ok': True}

    @route.get('/regions/neighbors/')
    def get_neighbor_map(self, request):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.geo.models import Region
        neighbor_map = {}
        for region in Region.objects.prefetch_related('neighbors').all():
            neighbor_map[str(region.id)] = [str(n.id) for n in region.neighbors.all()]
        return {'neighbors': neighbor_map}
