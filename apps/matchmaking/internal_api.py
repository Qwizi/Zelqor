import logging

from ninja_extra import ControllerBase, api_controller, route
from ninja import Schema

from apps.internal_auth import check_internal_secret

logger = logging.getLogger(__name__)


def _consume_default_deck(user) -> dict:
    """Consume items from the user's default deck and return a deck_snapshot dict.

    For each DeckItem in the default deck:
    - Reduces quantity in UserInventory (capped at zero — items are silently skipped
      if the user no longer has them, which can happen if inventory changed since
      the deck was built).
    - Classifies the item into the appropriate snapshot bucket:
        blueprint_building -> unlocked_buildings, building_levels (slug -> max level)
        blueprint_unit     -> unlocked_units
        tactical_package   -> ability_scrolls (slug -> 999 uses), ability_levels (slug -> level)
        boost              -> active_boosts (slug, params including level)

    Tarcza (Shield) Lvl 1 is always available as a free ability regardless of deck.
    Returns at minimum the free ability even if the user has no default deck.
    """
    from apps.inventory.models import Deck, Item, UserInventory
    from django.db import transaction

    # Free ability — always available
    ability_scrolls: dict[str, int] = {'ab_shield': 999}
    ability_levels: dict[str, int] = {'ab_shield': 1}

    unlocked_buildings: list[str] = []
    building_levels: dict[str, int] = {}
    unlocked_units: list[str] = []
    active_boosts: list[dict] = []

    try:
        deck = Deck.objects.prefetch_related(
            'items__item'
        ).get(user=user, is_default=True)
    except Deck.DoesNotExist:
        return {
            'unlocked_buildings': unlocked_buildings,
            'building_levels': building_levels,
            'unlocked_units': unlocked_units,
            'ability_scrolls': ability_scrolls,
            'ability_levels': ability_levels,
            'active_boosts': active_boosts,
        }

    with transaction.atomic():
        for deck_item in deck.items.select_related('item').all():
            item = deck_item.item
            qty = deck_item.quantity

            # Tactical packages are permanent — they unlock abilities without being consumed.
            if item.item_type == Item.ItemType.TACTICAL_PACKAGE:
                # Verify user still owns at least 1 (don't consume)
                if not UserInventory.objects.filter(user=user, item=item, quantity__gte=1).exists():
                    continue
                ability_slug = item.blueprint_ref or item.slug
                ability_scrolls[ability_slug] = 999  # unlimited uses per match
                # Track the highest level the player has for this ability
                ability_levels[ability_slug] = max(
                    ability_levels.get(ability_slug, 0), item.level
                )
                continue

            # Consume other item types from inventory
            consumed = 0
            try:
                inv = UserInventory.objects.select_for_update().get(
                    user=user, item=item
                )
                consumed = min(inv.quantity, qty)
                inv.quantity -= consumed
                if inv.quantity == 0:
                    inv.delete()
                else:
                    inv.save(update_fields=['quantity'])
            except UserInventory.DoesNotExist:
                consumed = 0

            if consumed == 0:
                continue

            # Classify into snapshot buckets
            if item.item_type == Item.ItemType.BLUEPRINT_BUILDING:
                if item.blueprint_ref:
                    if item.blueprint_ref not in unlocked_buildings:
                        unlocked_buildings.append(item.blueprint_ref)
                    # Track the highest buildable level for this building
                    building_levels[item.blueprint_ref] = max(
                        building_levels.get(item.blueprint_ref, 0), item.level
                    )
            elif item.item_type == Item.ItemType.BLUEPRINT_UNIT:
                if item.blueprint_ref and item.blueprint_ref not in unlocked_units:
                    unlocked_units.append(item.blueprint_ref)
            elif item.item_type == Item.ItemType.BOOST:
                active_boosts.append({
                    'slug': item.slug,
                    'params': {**(item.boost_params or {}), 'level': item.level},
                })

    return {
        'unlocked_buildings': unlocked_buildings,
        'building_levels': building_levels,
        'unlocked_units': unlocked_units,
        'ability_scrolls': ability_scrolls,
        'ability_levels': ability_levels,
        'active_boosts': active_boosts,
    }


# --- Schemas ---


class QueueAddRequest(Schema):
    user_id: str
    game_mode: str | None = None


class QueueRemoveRequest(Schema):
    user_id: str


class TryMatchRequest(Schema):
    game_mode: str | None = None


class FillWithBotsRequest(Schema):
    game_mode: str | None = None


# --- Controller ---


@api_controller('/internal/matchmaking', tags=['internal'])
class MatchmakingInternalController(ControllerBase):
    """Internal API for the Rust gateway — matchmaking endpoints."""

    @route.post('/queue/add/')
    def add_to_queue(self, request, body: QueueAddRequest):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.accounts.models import User
        from apps.game_config.models import GameMode
        from apps.matchmaking.models import MatchQueue

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({'error': 'User not found'}, status_code=404)

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
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.matchmaking.models import MatchQueue
        MatchQueue.objects.filter(user_id=body.user_id).delete()
        return {'ok': True}

    @route.get('/queue/count/')
    def get_queue_count(self, request, game_mode: str | None = None):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

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
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

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

    @route.post('/fill-with-bots/')
    def fill_with_bots(self, request, body: FillWithBotsRequest):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        import logging
        import random

        from apps.accounts.models import User
        from apps.game_config.models import GameMode, GameSettings
        from apps.matchmaking.models import Match, MatchQueue

        # Resolve game mode
        if body.game_mode:
            game_mode = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        logger.info(f"fill_with_bots: game_mode={body.game_mode} resolved={game_mode}")

        if not game_mode:
            settings_obj = GameSettings.get()
            min_players = settings_obj.min_players
        else:
            min_players = game_mode.min_players

        queue_qs = MatchQueue.objects.select_related('user').order_by('joined_at')
        if game_mode:
            queue_qs = queue_qs.filter(game_mode=game_mode)

        human_count = queue_qs.count()
        logger.info(f"fill_with_bots: human_count={human_count}, min_players={min_players}")
        if human_count == 0:
            return {'match_id': None, 'user_ids': None, 'bot_ids': None}

        needed = min_players - human_count
        if needed <= 0:
            return {'match_id': None, 'user_ids': None, 'bot_ids': None}

        available_bots = list(
            User.objects.filter(is_bot=True)
            .values_list('id', flat=True)
        )
        random.shuffle(available_bots)
        chosen_bots = available_bots[:needed]

        if len(chosen_bots) < needed:
            return {'match_id': None, 'user_ids': None, 'bot_ids': None}

        # Add bots to queue
        for bot_id in chosen_bots:
            MatchQueue.objects.update_or_create(
                user_id=bot_id,
                defaults={'game_mode': game_mode},
            )

        # Now call try_match logic inline
        return self._do_try_match(request, game_mode)

    @route.post('/try-match/')
    def try_match(self, request, body: TryMatchRequest):
        if not check_internal_secret(request):
            return self.create_response({'error': 'Unauthorized'}, status_code=403)

        from apps.game_config.models import GameMode

        if body.game_mode:
            game_mode = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        return self._do_try_match(request, game_mode)

    def _do_try_match(self, request, game_mode):
        from django.utils import timezone
        from apps.game_config.models import AbilityType, BuildingType, GameSettings, MapConfig, UnitType
        from apps.matchmaking.models import Match, MatchPlayer, MatchQueue

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
                'energy_cost': bt.energy_cost,
                'build_time_ticks': bt.build_time_ticks,
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
                'production_cost': int(ut.production_cost),
                'production_time_ticks': int(ut.production_time_ticks),
                'manpower_cost': int(ut.manpower_cost),
                'max_level': ut.max_level,
                'level_stats': ut.level_stats or {},
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
                'starting_energy': src.starting_energy,
                'base_energy_per_tick': src.base_energy_per_tick,
                'region_energy_per_tick': src.region_energy_per_tick,
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
                'match_duration_limit_minutes': src.match_duration_limit_minutes,
            },
        )

        colors = ['#FF4444', '#4444FF', '#44FF44', '#FFFF44', '#FF44FF', '#44FFFF', '#FF8844', '#8844FF']

        users = []
        bot_ids = []
        entry_ids = []
        for i, entry in enumerate(queue_entries):
            deck_snapshot = {}
            if not entry.user.is_bot:
                deck_snapshot = _consume_default_deck(entry.user)

            MatchPlayer.objects.create(
                match=match,
                user=entry.user,
                color=colors[i % len(colors)],
                deck_snapshot=deck_snapshot,
            )
            users.append(str(entry.user.id))
            if entry.user.is_bot:
                bot_ids.append(str(entry.user.id))
            entry_ids.append(entry.id)

        MatchQueue.objects.filter(id__in=entry_ids).delete()

        return {
            'match_id': str(match.id),
            'user_ids': users,
            'bot_ids': bot_ids,
        }
