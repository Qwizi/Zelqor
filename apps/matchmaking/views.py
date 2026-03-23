from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from apps.accounts.auth import ActiveUserJWTAuth
from apps.game_config.decorators import require_module_controller

from django.shortcuts import get_object_or_404
from apps.matchmaking.models import Match, MatchPlayer, MatchQueue, Lobby, LobbyPlayer
from apps.matchmaking.schemas import (
    MatchOutSchema,
    MatchmakingStatusSchema,
    MatchmakingStatusInMatchSchema,
    MatchmakingStatusInLobbySchema,
    MatchmakingStatusInQueueSchema,
    MatchmakingStatusIdleSchema,
    LobbyPlayerStatusSchema,
)
from apps.pagination import paginate_qs


@api_controller('/matches', tags=['Matches'])
@require_module_controller('matchmaking')
class MatchController:

    @route.get('/', response=dict, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def list_my_matches(self, request, limit: int = 50, offset: int = 0):
        """List matches for the authenticated user (excludes tutorial matches)."""
        qs = (
            Match.objects.filter(players__user=request.auth)
            .exclude(is_tutorial=True)
            .prefetch_related('players', 'players__user')
            .distinct()
        )
        return paginate_qs(qs, limit, offset, schema=MatchOutSchema)

    @route.get('/player/{user_id}/', response=dict, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def list_player_matches(self, request, user_id: str, limit: int = 50, offset: int = 0):
        """List matches for any player by user ID."""
        qs = (
            Match.objects.filter(players__user_id=user_id)
            .exclude(is_tutorial=True)
            .prefetch_related('players', 'players__user')
            .distinct()
        )
        return paginate_qs(qs, limit, offset, schema=MatchOutSchema)

    @route.get('/{match_id}/', response=MatchOutSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def get_match(self, request, match_id: str):
        return get_object_or_404(Match.objects.prefetch_related('players', 'players__user'), id=match_id)


@api_controller('/matches/tutorial', tags=['Tutorial'])
@require_module_controller('tutorial')
class TutorialController:

    @route.post('/start/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def start_tutorial(self, request):
        """Start a tutorial match. Returns existing active tutorial if one exists."""
        from apps.game_config.models import AbilityType, BuildingType, GameMode, UnitType
        from apps.accounts.models import User
        from apps.matchmaking.models import MatchPlayer

        user = request.auth

        # Delete any existing tutorial matches for this user
        Match.objects.filter(
            is_tutorial=True,
            players__user=user,
        ).delete()

        # Get tutorial game mode
        tutorial_mode = get_object_or_404(GameMode, slug='tutorial')

        # Use the same map as other modes (fallback to default active MapConfig)
        from apps.game_config.models import MapConfig as MapConfigModel
        map_config = tutorial_mode.map_config or MapConfigModel.objects.filter(is_active=True).first()

        # Snapshot building types — mirrors _do_try_match exactly
        building_types = {
            bt.slug: {
                'cost': (bt.level_stats or {}).get('1', {}).get('cost', 0),
                'energy_cost': (bt.level_stats or {}).get('1', {}).get('energy_cost', 0),
                'build_time_ticks': (bt.level_stats or {}).get('1', {}).get('build_time_ticks', 1),
                'max_per_region': bt.max_per_region,
                'defense_bonus': bt.defense_bonus,
                'vision_range': bt.vision_range,
                'unit_generation_bonus': bt.unit_generation_bonus,
                'energy_generation_bonus': bt.energy_generation_bonus,
                'requires_coastal': bt.requires_coastal,
                'icon': bt.icon,
                'name': bt.name,
                'asset_key': bt.asset_key,
                'order': bt.order,
                'max_level': bt.max_level,
                'level_stats': bt.level_stats or {},
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
                'production_cost': (ut.level_stats or {}).get('1', {}).get('production_cost', 0),
                'production_time_ticks': (ut.level_stats or {}).get('1', {}).get('production_time_ticks', 0),
                'manpower_cost': (ut.level_stats or {}).get('1', {}).get('manpower_cost', 1),
                'max_level': ut.max_level,
                'level_stats': ut.level_stats or {},
                'is_stealth': ut.is_stealth,
                'path_damage': ut.path_damage,
                'aoe_damage': ut.aoe_damage,
                'blockade_port': ut.blockade_port,
                'intercept_air': ut.intercept_air,
                'can_station_anywhere': ut.can_station_anywhere,
                'lifetime_ticks': ut.lifetime_ticks,
                'combat_target': ut.combat_target,
                'ticks_per_hop': ut.ticks_per_hop,
                'air_speed_ticks_per_hop': ut.air_speed_ticks_per_hop,
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
                'energy_cost': int(at.energy_cost),
                'cooldown_ticks': int(at.cooldown_ticks),
                'damage': int(at.damage),
                'effect_duration_ticks': int(at.effect_duration_ticks),
                'effect_params': at.effect_params or {},
                'max_level': at.max_level,
                'level_stats': at.level_stats or {},
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

        # Tutorial overrides — everything dirt cheap, fast build, short cooldowns
        for bt in building_types.values():
            bt['cost'] = 0
            bt['energy_cost'] = 10
            bt['build_time_ticks'] = 3
            for level_data in bt['level_stats'].values():
                level_data['cost'] = 0
                level_data['energy_cost'] = 10
                level_data['build_time_ticks'] = 3
        for ut in unit_types.values():
            if ut['production_cost'] > 0:
                ut['production_cost'] = 5
                ut['production_time_ticks'] = 2
                for level_data in ut['level_stats'].values():
                    if level_data.get('production_cost', 0) > 0:
                        level_data['production_cost'] = 5
                        level_data['production_time_ticks'] = 2
        for at in ability_types.values():
            at['energy_cost'] = 10  # All abilities cost 10
            at['cooldown_ticks'] = 5  # 5 tick cooldown

        settings_snapshot = {
            'tick_interval_ms': tutorial_mode.tick_interval_ms,
            'capital_selection_time_seconds': tutorial_mode.capital_selection_time_seconds,
            'match_duration_limit_minutes': tutorial_mode.match_duration_limit_minutes,
            'base_unit_generation_rate': tutorial_mode.base_unit_generation_rate,
            'capital_generation_bonus': tutorial_mode.capital_generation_bonus,
            'starting_energy': tutorial_mode.starting_energy,
            'base_energy_per_tick': tutorial_mode.base_energy_per_tick,
            'region_energy_per_tick': tutorial_mode.region_energy_per_tick,
            'attacker_advantage': tutorial_mode.attacker_advantage,
            'defender_advantage': tutorial_mode.defender_advantage,
            'combat_randomness': tutorial_mode.combat_randomness,
            'starting_units': tutorial_mode.starting_units,
            'neutral_region_units': tutorial_mode.neutral_region_units,
            'elo_k_factor': tutorial_mode.elo_k_factor,
            'min_capital_distance': 0,  # No distance restriction for tutorial
            'building_types': building_types,
            'unit_types': unit_types,
            'ability_types': ability_types,
            'default_unit_type_slug': default_unit_type_slug,
            'capital_protection_ticks': tutorial_mode.capital_protection_ticks,
            'nap_minimum_duration_ticks': tutorial_mode.nap_minimum_duration_ticks,
            'peace_cooldown_ticks': tutorial_mode.peace_cooldown_ticks,
            'proposal_timeout_ticks': tutorial_mode.proposal_timeout_ticks,
            'diplomacy_enabled': tutorial_mode.diplomacy_enabled,
        }

        COLORS = ['#22d3ee', '#f43f5e', '#a3e635', '#fbbf24', '#c084fc', '#fb923c']

        # Create the match
        match = Match.objects.create(
            status=Match.Status.WAITING,
            game_mode=tutorial_mode,
            map_config=map_config,
            max_players=2,
            is_tutorial=True,
            settings_snapshot=settings_snapshot,
        )

        # Add the human player
        MatchPlayer.objects.create(
            match=match,
            user=user,
            color=COLORS[0],
        )

        # Get the tutorial bot (created by create_bots command)
        bot = get_object_or_404(User, username='TutorialBot', is_bot=True)

        MatchPlayer.objects.create(
            match=match,
            user=bot,
            color=COLORS[1],
        )

        # Advance to selecting so the Rust gateway can accept WebSocket connections
        match.status = Match.Status.SELECTING
        match.save(update_fields=['status'])

        return {'match_id': str(match.id)}

    @route.post('/cleanup/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def cleanup_tutorial(self, request):
        """Cancel and delete all tutorial matches for the user."""
        user = request.auth
        tutorials = Match.objects.filter(
            is_tutorial=True,
            players__user=user,
        )
        tutorials.update(status=Match.Status.CANCELLED)
        tutorials.delete()
        return {'ok': True}


@api_controller('/matchmaking', tags=['Matchmaking'])
@require_module_controller('matchmaking')
class MatchmakingStatusController:

    @route.get('/status/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def get_matchmaking_status(self, request):
        """
        Return the current matchmaking state for the authenticated player.

        Priority order:
        1. Active match (in_progress or selecting) → state: in_match
        2. Active lobby (waiting, full, or ready) → state: in_lobby
        3. Matchmaking queue entry → state: in_queue
        4. Otherwise → state: idle
        """
        user = request.auth

        # 1. Check for an active match
        active_match = (
            Match.objects.filter(
                players__user=user,
                status__in=[Match.Status.IN_PROGRESS, Match.Status.SELECTING],
            )
            .order_by('-created_at')
            .first()
        )
        if active_match:
            return {'state': 'in_match', 'match_id': str(active_match.id)}

        # 2. Check for an active lobby
        lobby_player = (
            LobbyPlayer.objects.select_related('lobby', 'lobby__game_mode')
            .filter(
                user=user,
                lobby__status__in=[
                    Lobby.Status.WAITING,
                    Lobby.Status.FULL,
                    Lobby.Status.READY,
                ],
            )
            .order_by('-lobby__created_at')
            .first()
        )
        if lobby_player:
            lobby = lobby_player.lobby
            lobby_players = (
                LobbyPlayer.objects.select_related('user')
                .filter(lobby=lobby)
                .order_by('joined_at')
            )
            return {
                'state': 'in_lobby',
                'lobby_id': str(lobby.id),
                'game_mode_slug': lobby.game_mode.slug if lobby.game_mode_id else None,
                'players': [
                    {
                        'user_id': str(lp.user_id),
                        'username': lp.user.username,
                        'is_ready': lp.is_ready,
                        'is_bot': lp.is_bot,
                    }
                    for lp in lobby_players
                ],
                'max_players': lobby.max_players,
            }

        # 3. Check the matchmaking queue
        try:
            queue_entry = MatchQueue.objects.select_related('game_mode').get(user=user)
            return {
                'state': 'in_queue',
                'game_mode_slug': queue_entry.game_mode.slug if queue_entry.game_mode_id else None,
                'joined_at': queue_entry.joined_at.isoformat(),
            }
        except MatchQueue.DoesNotExist:
            pass

        # 4. Idle
        return {'state': 'idle'}
