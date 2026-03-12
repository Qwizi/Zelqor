import logging

from django.conf import settings
from ninja_extra import ControllerBase, api_controller, route
from ninja import Schema

logger = logging.getLogger(__name__)


def check_internal_secret(request):
    """Verify X-Internal-Secret header matches configured secret."""
    expected = getattr(settings, 'INTERNAL_SECRET', 'dev-internal-secret')
    actual = request.META.get('HTTP_X_INTERNAL_SECRET', '')
    return actual == expected


# --- Schemas ---


class QueueAddRequest(Schema):
    user_id: str
    game_mode: str | None = None


class QueueRemoveRequest(Schema):
    user_id: str


class TryMatchRequest(Schema):
    game_mode: str | None = None


# --- Controller ---


@api_controller('/internal/matchmaking', tags=['internal'])
class MatchmakingInternalController(ControllerBase):
    """Internal API for the Rust gateway — matchmaking endpoints."""

    @route.post('/queue/add/')
    def add_to_queue(self, request, body: QueueAddRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.accounts.models import User
        from apps.game_config.models import GameMode
        from apps.matchmaking.models import MatchQueue

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response(request, {'error': 'User not found'}, status_code=404)

        game_mode = None
        if body.game_mode:
            game_mode = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        MatchQueue.objects.update_or_create(
            user=user,
            defaults={'game_mode': game_mode},
        )
        return {'ok': True}

    @route.post('/queue/remove/')
    def remove_from_queue(self, request, body: QueueRemoveRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.matchmaking.models import MatchQueue
        MatchQueue.objects.filter(user_id=body.user_id).delete()
        return {'ok': True}

    @route.get('/queue/count/')
    def get_queue_count(self, request, game_mode: str | None = None):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.game_config.models import GameMode
        from apps.matchmaking.models import MatchQueue

        gm = None
        if game_mode:
            gm = GameMode.objects.filter(slug=game_mode, is_active=True).first()
        else:
            gm = GameMode.objects.filter(is_default=True, is_active=True).first()

        if gm:
            count = MatchQueue.objects.filter(game_mode=gm).count()
        else:
            count = MatchQueue.objects.count()

        return {'count': count}

    @route.get('/active-match/{user_id}/')
    def get_active_match(self, request, user_id: str):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from apps.matchmaking.models import Match

        match_id = (
            Match.objects.filter(
                players__user_id=user_id,
                players__is_alive=True,
                status__in=[Match.Status.SELECTING, Match.Status.IN_PROGRESS],
            )
            .order_by('-created_at')
            .values_list('id', flat=True)
            .first()
        )

        return {'match_id': str(match_id) if match_id else None}

    @route.post('/try-match/')
    def try_match(self, request, body: TryMatchRequest):
        if not check_internal_secret(request):
            return self.create_response(request, {'error': 'Unauthorized'}, status_code=403)

        from django.utils import timezone
        from apps.game_config.models import AbilityType, BuildingType, GameMode, GameSettings, MapConfig, UnitType
        from apps.matchmaking.models import Match, MatchPlayer, MatchQueue

        # Resolve game mode
        if body.game_mode:
            game_mode = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        if not game_mode:
            settings_obj = GameSettings.get()
            min_players = settings_obj.min_players
            max_players = settings_obj.max_players
        else:
            min_players = game_mode.min_players
            max_players = game_mode.max_players

        queue_qs = MatchQueue.objects.select_related('user').order_by('joined_at')
        if game_mode:
            queue_qs = queue_qs.filter(game_mode=game_mode)

        queue_entries = list(queue_qs[:min_players])
        if len(queue_entries) < min_players:
            return {'match_id': None, 'user_ids': None}

        # Map config
        if game_mode and game_mode.map_config:
            map_config = game_mode.map_config
        else:
            map_config = MapConfig.objects.filter(is_active=True).first()

        # Snapshot building types
        building_types = {
            bt.slug: {
                'cost': bt.cost,
                'currency_cost': bt.currency_cost,
                'build_time_ticks': bt.build_time_ticks,
                'max_per_region': bt.max_per_region,
                'defense_bonus': bt.defense_bonus,
                'vision_range': bt.vision_range,
                'unit_generation_bonus': bt.unit_generation_bonus,
                'currency_generation_bonus': bt.currency_generation_bonus,
                'requires_coastal': bt.requires_coastal,
                'icon': bt.icon,
                'name': bt.name,
                'asset_key': bt.asset_key,
                'order': bt.order,
                'produced_unit_slug': (
                    bt.unit_types.filter(is_active=True)
                    .order_by('order')
                    .values_list('slug', flat=True)
                    .first()
                ),
            }
            for bt in BuildingType.objects.filter(is_active=True)
        }

        unit_types = {
            ut.slug: {
                'name': ut.name,
                'asset_key': ut.asset_key,
                'attack': float(ut.attack),
                'defense': float(ut.defense),
                'speed': int(ut.speed),
                'attack_range': int(ut.attack_range),
                'sea_range': int(ut.sea_range),
                'sea_hop_distance_km': int(ut.sea_hop_distance_km),
                'movement_type': ut.movement_type,
                'produced_by_slug': ut.produced_by.slug if ut.produced_by_id else None,
                'production_cost': int(ut.production_cost),
                'production_time_ticks': int(ut.production_time_ticks),
                'manpower_cost': int(ut.manpower_cost),
            }
            for ut in UnitType.objects.select_related('produced_by').filter(is_active=True)
        }

        ability_types = {
            at.slug: {
                'name': at.name,
                'asset_key': at.asset_key,
                'sound_key': at.sound_key,
                'target_type': at.target_type,
                'range': int(at.range),
                'currency_cost': int(at.currency_cost),
                'cooldown_ticks': int(at.cooldown_ticks),
                'damage': int(at.damage),
                'effect_duration_ticks': int(at.effect_duration_ticks),
                'effect_params': at.effect_params or {},
            }
            for at in AbilityType.objects.filter(is_active=True)
        }

        default_unit_type_slug = (
            UnitType.objects.filter(is_active=True, produced_by__isnull=True)
            .order_by('order')
            .values_list('slug', flat=True)
            .first()
            or 'infantry'
        )

        src = game_mode if game_mode else GameSettings.get()

        match = Match.objects.create(
            status=Match.Status.SELECTING,
            game_mode=game_mode,
            map_config=map_config,
            max_players=max_players,
            started_at=timezone.now(),
            settings_snapshot={
                'tick_interval_ms': src.tick_interval_ms,
                'capital_selection_time_seconds': src.capital_selection_time_seconds,
                'base_unit_generation_rate': src.base_unit_generation_rate,
                'capital_generation_bonus': src.capital_generation_bonus,
                'starting_currency': src.starting_currency,
                'base_currency_per_tick': src.base_currency_per_tick,
                'region_currency_per_tick': src.region_currency_per_tick,
                'attacker_advantage': src.attacker_advantage,
                'defender_advantage': src.defender_advantage,
                'combat_randomness': src.combat_randomness,
                'starting_units': src.starting_units,
                'neutral_region_units': src.neutral_region_units,
                'building_types': building_types,
                'unit_types': unit_types,
                'ability_types': ability_types,
                'default_unit_type_slug': default_unit_type_slug,
                'min_capital_distance': map_config.min_capital_distance if map_config else 3,
                'elo_k_factor': src.elo_k_factor,
            },
        )

        colors = ['#FF4444', '#4444FF', '#44FF44', '#FFFF44', '#FF44FF', '#44FFFF', '#FF8844', '#8844FF']

        users = []
        for i, entry in enumerate(queue_entries):
            MatchPlayer.objects.create(
                match=match,
                user=entry.user,
                color=colors[i % len(colors)],
            )
            users.append(str(entry.user.id))
            entry.delete()

        return {
            'match_id': str(match.id),
            'user_ids': users,
        }
