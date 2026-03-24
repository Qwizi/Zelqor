import logging

from ninja import Schema
from ninja_extra import ControllerBase, api_controller, route

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
    from django.db import transaction

    from apps.inventory.models import Deck, Item, ItemInstance, UserInventory

    # Free ability — always available
    ability_scrolls: dict[str, int] = {"ab_shield": 999}
    ability_levels: dict[str, int] = {"ab_shield": 1}

    # Default: all active buildings unlocked at level 1
    from apps.game_config.models import BuildingType as BuildingTypeModel

    all_building_slugs = list(BuildingTypeModel.objects.filter(is_active=True).values_list("slug", flat=True))
    unlocked_buildings: list[str] = list(all_building_slugs)
    building_levels: dict[str, int] = {slug: 1 for slug in all_building_slugs}
    unlocked_units: list[str] = []
    unit_levels: dict[str, int] = {}
    active_boosts: list[dict] = []
    instance_ids: list[str] = []

    try:
        deck = (
            Deck.objects.prefetch_related("items__item")
            .filter(user=user, is_default=True)
            .order_by("-created_at")
            .first()
        )
        if deck is None:
            raise Deck.DoesNotExist
    except Deck.DoesNotExist:
        return {
            "unlocked_buildings": unlocked_buildings,
            "building_levels": building_levels,
            "unlocked_units": unlocked_units,
            "unit_levels": unit_levels,
            "ability_scrolls": ability_scrolls,
            "ability_levels": ability_levels,
            "active_boosts": active_boosts,
            "instance_ids": instance_ids,
        }

    with transaction.atomic():
        # Use list() so we can safely delete deck items during iteration
        for deck_item in list(deck.items.select_related("item").all()):
            item = deck_item.item
            qty = deck_item.quantity

            # Non-consumable items: verify ownership but do NOT remove from
            # inventory or deck. They persist across matches.
            if not item.is_consumable:
                if item.is_stackable:
                    owns = UserInventory.objects.filter(
                        user=user,
                        item=item,
                        quantity__gte=1,
                    ).exists()
                else:
                    owns = ItemInstance.objects.filter(owner=user, item=item).exists()

                if not owns:
                    continue

                if item.item_type == Item.ItemType.TACTICAL_PACKAGE:
                    ability_slug = item.blueprint_ref or item.slug
                    ability_scrolls[ability_slug] = 999
                    ability_levels[ability_slug] = max(ability_levels.get(ability_slug, 0), item.level)
                elif item.item_type == Item.ItemType.BLUEPRINT_BUILDING:
                    if item.blueprint_ref:
                        if item.blueprint_ref not in unlocked_buildings:
                            unlocked_buildings.append(item.blueprint_ref)
                        building_levels[item.blueprint_ref] = max(
                            building_levels.get(item.blueprint_ref, 0), item.level
                        )
                elif item.item_type == Item.ItemType.BLUEPRINT_UNIT:
                    if item.blueprint_ref:
                        if item.blueprint_ref not in unlocked_units:
                            unlocked_units.append(item.blueprint_ref)
                        unit_levels[item.blueprint_ref] = max(unit_levels.get(item.blueprint_ref, 0), item.level)

                # Track instance IDs for post-match StatTrak updates
                if not item.is_stackable and deck_item.instance_id:
                    instance_ids.append(str(deck_item.instance_id))
                continue

            # Consumable items: remove from inventory AND deck on use.
            consumed = 0
            if item.is_stackable:
                try:
                    inv = UserInventory.objects.select_for_update().get(user=user, item=item)
                    consumed = min(inv.quantity, qty)
                    inv.quantity -= consumed
                    if inv.quantity == 0:
                        inv.delete()
                    else:
                        inv.save(update_fields=["quantity"])
                except UserInventory.DoesNotExist:
                    consumed = 0
            else:
                # Non-stackable consumable: delete the specific ItemInstance
                if deck_item.instance_id:
                    try:
                        inst = ItemInstance.objects.get(id=deck_item.instance_id, owner=user)
                        inst.delete()
                        consumed = 1
                    except ItemInstance.DoesNotExist:
                        consumed = 0
                else:
                    consumed = 0

            if consumed == 0:
                continue

            # Remove consumed item from deck
            deck_item.delete()

            # Classify consumed items into snapshot buckets
            if item.item_type == Item.ItemType.BOOST:
                active_boosts.append(
                    {
                        "slug": item.slug,
                        "params": {**(item.boost_params or {}), "level": item.level},
                    }
                )

    return {
        "unlocked_buildings": unlocked_buildings,
        "building_levels": building_levels,
        "unlocked_units": unlocked_units,
        "unit_levels": unit_levels,
        "ability_scrolls": ability_scrolls,
        "ability_levels": ability_levels,
        "active_boosts": active_boosts,
        "instance_ids": instance_ids,
    }


def _build_cosmetic_snapshot(user) -> dict:
    """Build cosmetic snapshot. Static skins are {slot: url_string}.
    VFX cosmetics are {slot: {url: str|None, params: dict}}."""
    from apps.inventory.models import EquippedCosmetic

    snapshot = {}
    for ec in EquippedCosmetic.objects.filter(user=user).select_related("item__cosmetic_asset"):
        url = None
        if ec.item.cosmetic_asset and ec.item.cosmetic_asset.file:
            url = ec.item.cosmetic_asset.file.url

        if ec.slot.startswith("vfx_"):
            # VFX slot: include params alongside URL
            entry = {
                "url": url,
                "params": ec.item.cosmetic_params or {},
            }
            if ec.instance_id:
                entry["instance_id"] = str(ec.instance_id)
            snapshot[ec.slot] = entry
        else:
            # Static skin slot: URL string when no instance, dict when instance exists
            if ec.instance_id:
                snapshot[ec.slot] = {
                    "url": url,
                    "instance_id": str(ec.instance_id),
                }
            elif url:
                snapshot[ec.slot] = url
    return snapshot


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


@api_controller("/internal/matchmaking", tags=["internal"])
class MatchmakingInternalController(ControllerBase):
    """Internal API for the Rust gateway — matchmaking endpoints."""

    @route.post("/queue/add/")
    def add_to_queue(self, request, body: QueueAddRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.accounts.models import User
        from apps.game_config.models import GameMode
        from apps.matchmaking.models import MatchQueue

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({"error": "User not found"}, status_code=404)

        game_mode = None
        if body.game_mode:
            game_mode = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        MatchQueue.objects.update_or_create(
            user=user,
            defaults={"game_mode": game_mode},
        )
        return {"ok": True}

    @route.post("/queue/remove/")
    def remove_from_queue(self, request, body: QueueRemoveRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import MatchQueue

        MatchQueue.objects.filter(user_id=body.user_id).delete()
        return {"ok": True}

    @route.get("/queue/count/")
    def get_queue_count(self, request, game_mode: str | None = None):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.game_config.models import GameMode
        from apps.matchmaking.models import MatchQueue

        gm = None
        if game_mode:
            gm = GameMode.objects.filter(slug=game_mode, is_active=True).first()
        else:
            gm = GameMode.objects.filter(is_default=True, is_active=True).first()

        count = MatchQueue.objects.filter(game_mode=gm).count() if gm else MatchQueue.objects.count()

        return {"count": count}

    @route.get("/active-match/{user_id}/")
    def get_active_match(self, request, user_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Match

        match_id = (
            Match.objects.filter(
                players__user_id=user_id,
                players__is_alive=True,
                status__in=[Match.Status.SELECTING, Match.Status.IN_PROGRESS],
            )
            .order_by("-created_at")
            .values_list("id", flat=True)
            .first()
        )

        return {"match_id": str(match_id) if match_id else None}

    @route.post("/fill-with-bots/")
    def fill_with_bots(self, request, body: FillWithBotsRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        import random

        from apps.accounts.models import User
        from apps.game_config.models import GameMode, GameSettings
        from apps.matchmaking.models import MatchQueue

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

        queue_qs = MatchQueue.objects.select_related("user").order_by("joined_at")
        if game_mode:
            queue_qs = queue_qs.filter(game_mode=game_mode)

        human_count = queue_qs.count()
        logger.info(f"fill_with_bots: human_count={human_count}, min_players={min_players}")
        if human_count == 0:
            return {"match_id": None, "user_ids": None, "bot_ids": None}

        needed = min_players - human_count
        if needed <= 0:
            return {"match_id": None, "user_ids": None, "bot_ids": None}

        available_bots = list(User.objects.filter(is_bot=True).values_list("id", flat=True))
        random.shuffle(available_bots)
        chosen_bots = available_bots[:needed]

        if len(chosen_bots) < needed:
            return {"match_id": None, "user_ids": None, "bot_ids": None}

        # Add bots to queue
        for bot_id in chosen_bots:
            MatchQueue.objects.update_or_create(
                user_id=bot_id,
                defaults={"game_mode": game_mode},
            )

        # Now call try_match logic inline
        return self._do_try_match(request, game_mode)

    @route.post("/try-match/")
    def try_match(self, request, body: TryMatchRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

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

        queue_qs = MatchQueue.objects.select_related("user").order_by("joined_at")
        if game_mode:
            queue_qs = queue_qs.filter(game_mode=game_mode)

        queue_entries = list(queue_qs[:min_players])
        if len(queue_entries) < min_players:
            return {"match_id": None, "user_ids": None}

        # Map config
        if game_mode and game_mode.map_config:
            map_config = game_mode.map_config
        else:
            map_config = MapConfig.objects.filter(is_active=True).first()

        # Snapshot building types
        building_types = {
            bt.slug: {
                "cost": (bt.level_stats or {}).get("1", {}).get("cost", 0),
                "energy_cost": (bt.level_stats or {}).get("1", {}).get("energy_cost", 0),
                "build_time_ticks": (bt.level_stats or {}).get("1", {}).get("build_time_ticks", 1),
                "max_per_region": bt.max_per_region,
                "defense_bonus": bt.defense_bonus,
                "vision_range": bt.vision_range,
                "unit_generation_bonus": bt.unit_generation_bonus,
                "energy_generation_bonus": bt.energy_generation_bonus,
                "requires_coastal": bt.requires_coastal,
                "icon": bt.icon,
                "name": bt.name,
                "asset_key": bt.asset_key,
                "order": bt.order,
                "max_level": bt.max_level,
                "level_stats": bt.level_stats or {},
                "produced_unit_slug": next(
                    (
                        ut.slug
                        for ut in sorted(
                            (u for u in bt.unit_types.all() if u.is_active),
                            key=lambda u: u.order,
                        )
                    ),
                    None,
                ),
            }
            for bt in BuildingType.objects.filter(is_active=True).prefetch_related("unit_types")
        }

        unit_types = {
            ut.slug: {
                "name": ut.name,
                "asset_key": ut.asset_key,
                "attack": float(ut.attack),
                "defense": float(ut.defense),
                "speed": int(ut.speed),
                "attack_range": int(ut.attack_range),
                "sea_range": int(ut.sea_range),
                "sea_hop_distance_km": int(ut.sea_hop_distance_km),
                "movement_type": ut.movement_type,
                "produced_by_slug": ut.produced_by.slug if ut.produced_by_id else None,
                "production_cost": (ut.level_stats or {}).get("1", {}).get("production_cost", 0),
                "production_time_ticks": (ut.level_stats or {}).get("1", {}).get("production_time_ticks", 0),
                "manpower_cost": (ut.level_stats or {}).get("1", {}).get("manpower_cost", 1),
                "max_level": ut.max_level,
                "level_stats": ut.level_stats or {},
                "is_stealth": ut.is_stealth,
                "path_damage": ut.path_damage,
                "aoe_damage": ut.aoe_damage,
                "blockade_port": ut.blockade_port,
                "intercept_air": ut.intercept_air,
                "can_station_anywhere": ut.can_station_anywhere,
                "lifetime_ticks": ut.lifetime_ticks,
                "combat_target": ut.combat_target,
                "ticks_per_hop": ut.ticks_per_hop,
                "air_speed_ticks_per_hop": ut.air_speed_ticks_per_hop,
            }
            for ut in UnitType.objects.select_related("produced_by").filter(is_active=True)
        }

        ability_types = {
            at.slug: {
                "name": at.name,
                "asset_key": at.asset_key,
                "sound_key": at.sound_key,
                "target_type": at.target_type,
                "range": int(at.range),
                "energy_cost": int(at.energy_cost),
                "cooldown_ticks": int(at.cooldown_ticks),
                "damage": int(at.damage),
                "effect_duration_ticks": int(at.effect_duration_ticks),
                "effect_params": at.effect_params or {},
                "max_level": at.max_level,
                "level_stats": at.level_stats or {},
            }
            for at in AbilityType.objects.filter(is_active=True)
        }

        default_unit_type_slug = (
            UnitType.objects.filter(is_active=True, produced_by__isnull=True)
            .order_by("order")
            .values_list("slug", flat=True)
            .first()
            or "infantry"
        )

        src = game_mode if game_mode else GameSettings.get()

        match = Match.objects.create(
            status=Match.Status.SELECTING,
            game_mode=game_mode,
            map_config=map_config,
            max_players=max_players,
            started_at=timezone.now(),
            settings_snapshot={
                "tick_interval_ms": src.tick_interval_ms,
                "capital_selection_time_seconds": src.capital_selection_time_seconds,
                "base_unit_generation_rate": src.base_unit_generation_rate,
                "capital_generation_bonus": src.capital_generation_bonus,
                "starting_energy": src.starting_energy,
                "base_energy_per_tick": src.base_energy_per_tick,
                "region_energy_per_tick": src.region_energy_per_tick,
                "attacker_advantage": src.attacker_advantage,
                "defender_advantage": src.defender_advantage,
                "combat_randomness": src.combat_randomness,
                "starting_units": src.starting_units,
                "neutral_region_units": src.neutral_region_units,
                "building_types": building_types,
                "unit_types": unit_types,
                "ability_types": ability_types,
                "default_unit_type_slug": default_unit_type_slug,
                "min_capital_distance": map_config.min_capital_distance if map_config else 3,
                "elo_k_factor": src.elo_k_factor,
                "match_duration_limit_minutes": src.match_duration_limit_minutes,
                "weather_enabled": src.weather_enabled,
                "day_night_enabled": src.day_night_enabled,
                "night_defense_modifier": src.night_defense_modifier,
                "dawn_dusk_defense_modifier": src.dawn_dusk_defense_modifier,
                "storm_randomness_modifier": src.storm_randomness_modifier,
                "fog_randomness_modifier": src.fog_randomness_modifier,
                "rain_randomness_modifier": src.rain_randomness_modifier,
                "storm_energy_modifier": src.storm_energy_modifier,
                "rain_energy_modifier": src.rain_energy_modifier,
                "storm_unit_gen_modifier": src.storm_unit_gen_modifier,
                "rain_unit_gen_modifier": src.rain_unit_gen_modifier,
                "disconnect_grace_seconds": src.disconnect_grace_seconds,
                "max_build_queue_per_region": src.max_build_queue_per_region,
                "max_unit_queue_per_region": src.max_unit_queue_per_region,
                "casualty_factor": src.casualty_factor,
                "snapshot_interval_ticks": src.snapshot_interval_ticks,
                "capital_protection_ticks": src.capital_protection_ticks,
                "nap_minimum_duration_ticks": src.nap_minimum_duration_ticks,
                "peace_cooldown_ticks": src.peace_cooldown_ticks,
                "proposal_timeout_ticks": src.proposal_timeout_ticks,
                "diplomacy_enabled": src.diplomacy_enabled,
            },
        )

        # Apply game module overrides to settings_snapshot
        from apps.game_config.modules import get_all_module_configs, get_modules_snapshot

        modules_dict, flat_overrides = get_modules_snapshot(src)
        snapshot = match.settings_snapshot
        snapshot.update(flat_overrides)
        snapshot["modules"] = modules_dict
        # Include system module configs so gateway has access to anticheat/chat/etc settings
        snapshot["system_modules"] = get_all_module_configs()
        match.settings_snapshot = snapshot
        match.save(update_fields=["settings_snapshot"])

        colors = ["#FF4444", "#4444FF", "#44FF44", "#FFFF44", "#FF44FF", "#44FFFF", "#FF8844", "#8844FF"]

        users = []
        bot_ids = []
        entry_ids = []
        for i, entry in enumerate(queue_entries):
            deck_snapshot = {}
            cosmetic_snapshot = {}
            if not entry.user.is_bot:
                deck_snapshot = _consume_default_deck(entry.user)
                cosmetic_snapshot = _build_cosmetic_snapshot(entry.user)

            MatchPlayer.objects.create(
                match=match,
                user=entry.user,
                color=colors[i % len(colors)],
                deck_snapshot=deck_snapshot,
                cosmetic_snapshot=cosmetic_snapshot,
            )
            users.append(str(entry.user.id))
            if entry.user.is_bot:
                bot_ids.append(str(entry.user.id))
            entry_ids.append(entry.id)

        MatchQueue.objects.filter(id__in=entry_ids).delete()

        return {
            "match_id": str(match.id),
            "user_ids": users,
            "bot_ids": bot_ids,
        }


def _create_match_from_users(users, game_mode, *, team_labels: dict | None = None):
    """Shared helper: create a Match and MatchPlayer entries for the given list of
    User objects and an optional GameMode.  Mirrors the logic in _do_try_match but
    accepts a pre-resolved user list instead of pulling from MatchQueue.

    team_labels: optional dict of {str(user_id): team_label} for team-based modes.

    Returns the same dict shape as _do_try_match:
        {'match_id': str, 'user_ids': [...], 'bot_ids': [...]}
    """
    from django.utils import timezone

    from apps.game_config.models import AbilityType, BuildingType, GameSettings, MapConfig, UnitType
    from apps.matchmaking.models import Match, MatchPlayer

    if not game_mode:
        settings_obj = GameSettings.get()
        max_players = settings_obj.max_players
    else:
        max_players = game_mode.max_players

    # Map config
    if game_mode and game_mode.map_config:
        map_config = game_mode.map_config
    else:
        map_config = MapConfig.objects.filter(is_active=True).first()

    # Snapshot building types
    building_types = {
        bt.slug: {
            "cost": (bt.level_stats or {}).get("1", {}).get("cost", 0),
            "energy_cost": (bt.level_stats or {}).get("1", {}).get("energy_cost", 0),
            "build_time_ticks": (bt.level_stats or {}).get("1", {}).get("build_time_ticks", 1),
            "max_per_region": bt.max_per_region,
            "defense_bonus": bt.defense_bonus,
            "vision_range": bt.vision_range,
            "unit_generation_bonus": bt.unit_generation_bonus,
            "energy_generation_bonus": bt.energy_generation_bonus,
            "requires_coastal": bt.requires_coastal,
            "icon": bt.icon,
            "name": bt.name,
            "asset_key": bt.asset_key,
            "order": bt.order,
            "max_level": bt.max_level,
            "level_stats": bt.level_stats or {},
            "produced_unit_slug": next(
                (
                    ut.slug
                    for ut in sorted(
                        (u for u in bt.unit_types.all() if u.is_active),
                        key=lambda u: u.order,
                    )
                ),
                None,
            ),
        }
        for bt in BuildingType.objects.filter(is_active=True).prefetch_related("unit_types")
    }

    unit_types = {
        ut.slug: {
            "name": ut.name,
            "asset_key": ut.asset_key,
            "attack": float(ut.attack),
            "defense": float(ut.defense),
            "speed": int(ut.speed),
            "attack_range": int(ut.attack_range),
            "sea_range": int(ut.sea_range),
            "sea_hop_distance_km": int(ut.sea_hop_distance_km),
            "movement_type": ut.movement_type,
            "produced_by_slug": ut.produced_by.slug if ut.produced_by_id else None,
            "production_cost": (ut.level_stats or {}).get("1", {}).get("production_cost", 0),
            "production_time_ticks": (ut.level_stats or {}).get("1", {}).get("production_time_ticks", 0),
            "manpower_cost": (ut.level_stats or {}).get("1", {}).get("manpower_cost", 1),
            "max_level": ut.max_level,
            "level_stats": ut.level_stats or {},
            "is_stealth": ut.is_stealth,
            "path_damage": ut.path_damage,
            "aoe_damage": ut.aoe_damage,
            "blockade_port": ut.blockade_port,
            "intercept_air": ut.intercept_air,
            "can_station_anywhere": ut.can_station_anywhere,
            "lifetime_ticks": ut.lifetime_ticks,
            "combat_target": ut.combat_target,
            "ticks_per_hop": ut.ticks_per_hop,
            "air_speed_ticks_per_hop": ut.air_speed_ticks_per_hop,
        }
        for ut in UnitType.objects.select_related("produced_by").filter(is_active=True)
    }

    ability_types = {
        at.slug: {
            "name": at.name,
            "asset_key": at.asset_key,
            "sound_key": at.sound_key,
            "target_type": at.target_type,
            "range": int(at.range),
            "energy_cost": int(at.energy_cost),
            "cooldown_ticks": int(at.cooldown_ticks),
            "damage": int(at.damage),
            "effect_duration_ticks": int(at.effect_duration_ticks),
            "effect_params": at.effect_params or {},
            "max_level": at.max_level,
            "level_stats": at.level_stats or {},
        }
        for at in AbilityType.objects.filter(is_active=True)
    }

    default_unit_type_slug = (
        UnitType.objects.filter(is_active=True, produced_by__isnull=True)
        .order_by("order")
        .values_list("slug", flat=True)
        .first()
        or "infantry"
    )

    src = game_mode if game_mode else GameSettings.get()

    match = Match.objects.create(
        status=Match.Status.SELECTING,
        game_mode=game_mode,
        map_config=map_config,
        max_players=max_players,
        started_at=timezone.now(),
        settings_snapshot={
            "tick_interval_ms": src.tick_interval_ms,
            "capital_selection_time_seconds": src.capital_selection_time_seconds,
            "base_unit_generation_rate": src.base_unit_generation_rate,
            "capital_generation_bonus": src.capital_generation_bonus,
            "starting_energy": src.starting_energy,
            "base_energy_per_tick": src.base_energy_per_tick,
            "region_energy_per_tick": src.region_energy_per_tick,
            "attacker_advantage": src.attacker_advantage,
            "defender_advantage": src.defender_advantage,
            "combat_randomness": src.combat_randomness,
            "starting_units": src.starting_units,
            "neutral_region_units": src.neutral_region_units,
            "building_types": building_types,
            "unit_types": unit_types,
            "ability_types": ability_types,
            "default_unit_type_slug": default_unit_type_slug,
            "min_capital_distance": map_config.min_capital_distance if map_config else 3,
            "elo_k_factor": src.elo_k_factor,
            "match_duration_limit_minutes": src.match_duration_limit_minutes,
            "weather_enabled": src.weather_enabled,
            "day_night_enabled": src.day_night_enabled,
            "night_defense_modifier": src.night_defense_modifier,
            "dawn_dusk_defense_modifier": src.dawn_dusk_defense_modifier,
            "storm_randomness_modifier": src.storm_randomness_modifier,
            "fog_randomness_modifier": src.fog_randomness_modifier,
            "rain_randomness_modifier": src.rain_randomness_modifier,
            "storm_energy_modifier": src.storm_energy_modifier,
            "rain_energy_modifier": src.rain_energy_modifier,
            "storm_unit_gen_modifier": src.storm_unit_gen_modifier,
            "rain_unit_gen_modifier": src.rain_unit_gen_modifier,
            "disconnect_grace_seconds": src.disconnect_grace_seconds,
            "max_build_queue_per_region": src.max_build_queue_per_region,
            "max_unit_queue_per_region": src.max_unit_queue_per_region,
            "casualty_factor": src.casualty_factor,
            "snapshot_interval_ticks": src.snapshot_interval_ticks,
            "capital_protection_ticks": src.capital_protection_ticks,
            "nap_minimum_duration_ticks": src.nap_minimum_duration_ticks,
            "peace_cooldown_ticks": src.peace_cooldown_ticks,
            "proposal_timeout_ticks": src.proposal_timeout_ticks,
            "diplomacy_enabled": src.diplomacy_enabled,
        },
    )

    # Apply game module overrides to settings_snapshot
    from apps.game_config.modules import get_all_module_configs, get_modules_snapshot

    modules_dict, flat_overrides = get_modules_snapshot(src)
    snapshot = match.settings_snapshot
    snapshot.update(flat_overrides)
    snapshot["modules"] = modules_dict
    snapshot["system_modules"] = get_all_module_configs()
    match.settings_snapshot = snapshot
    match.save(update_fields=["settings_snapshot"])

    colors = ["#FF4444", "#4444FF", "#44FF44", "#FFFF44", "#FF44FF", "#44FFFF", "#FF8844", "#8844FF"]

    user_ids = []
    bot_ids = []
    for i, user in enumerate(users):
        deck_snapshot = {}
        cosmetic_snapshot = {}
        if not user.is_bot:
            deck_snapshot = _consume_default_deck(user)
            cosmetic_snapshot = _build_cosmetic_snapshot(user)

        MatchPlayer.objects.create(
            match=match,
            user=user,
            color=colors[i % len(colors)],
            deck_snapshot=deck_snapshot,
            cosmetic_snapshot=cosmetic_snapshot,
            team_label=(team_labels or {}).get(str(user.id)),
        )
        user_ids.append(str(user.id))
        if user.is_bot:
            bot_ids.append(str(user.id))

    return {
        "match_id": str(match.id),
        "user_ids": user_ids,
        "bot_ids": bot_ids,
    }


# --- Lobby Schemas ---


class CreateLobbyRequest(Schema):
    user_id: str
    game_mode: str | None = None


class JoinLobbyRequest(Schema):
    lobby_id: str
    user_id: str
    is_bot: bool = False


class LeaveLobbyRequest(Schema):
    lobby_id: str
    user_id: str


class SetReadyRequest(Schema):
    lobby_id: str
    user_id: str
    is_ready: bool = True


class FillLobbyBotsRequest(Schema):
    lobby_id: str


class StartMatchFromLobbyRequest(Schema):
    lobby_id: str


# --- Lobby Controller ---


def _lobby_player_dict(p) -> dict:
    return {
        "user_id": str(p.user_id),
        "username": p.user.username,
        "is_bot": p.is_bot,
        "is_ready": p.is_ready,
        "team_label": p.team_label,
    }


@api_controller("/internal/lobby", tags=["internal"])
class LobbyInternalController(ControllerBase):
    """Internal API for the Rust gateway — lobby endpoints."""

    @route.post("/create/")
    def create_lobby(self, request, body: CreateLobbyRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.accounts.models import User
        from apps.game_config.models import GameMode, GameSettings
        from apps.matchmaking.models import Lobby, LobbyPlayer

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({"error": "User not found"}, status_code=404)

        game_mode = None
        if body.game_mode:
            game_mode = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            game_mode = GameMode.objects.filter(is_default=True, is_active=True).first()

        max_players = game_mode.max_players if game_mode else GameSettings.get().max_players

        lobby = Lobby.objects.create(
            host_user=user,
            game_mode=game_mode,
            max_players=max_players,
        )
        LobbyPlayer.objects.create(lobby=lobby, user=user, is_bot=user.is_bot)

        players = list(lobby.players.select_related("user").all())

        return {
            "lobby_id": str(lobby.id),
            "max_players": lobby.max_players,
            "players": [_lobby_player_dict(p) for p in players],
        }

    @route.post("/join/")
    def join_lobby(self, request, body: JoinLobbyRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.accounts.models import User
        from apps.matchmaking.models import Lobby, LobbyPlayer

        try:
            lobby = Lobby.objects.get(id=body.lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        if lobby.status not in (Lobby.Status.WAITING,):
            return self.create_response({"error": "Lobby is not open"}, status_code=400)

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({"error": "User not found"}, status_code=404)

        LobbyPlayer.objects.get_or_create(
            lobby=lobby,
            user=user,
            defaults={"is_bot": body.is_bot},
        )

        from django.utils import timezone as tz

        player_count = lobby.players.count()
        if player_count >= lobby.max_players:
            lobby.status = Lobby.Status.FULL
            lobby.full_at = tz.now()
            lobby.save(update_fields=["status", "full_at"])

        players = list(lobby.players.select_related("user").all())

        return {
            "players": [_lobby_player_dict(p) for p in players],
            "status": lobby.status,
        }

    @route.post("/leave/")
    def leave_lobby(self, request, body: LeaveLobbyRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Lobby, LobbyPlayer

        try:
            lobby = Lobby.objects.select_related("host_user").get(id=body.lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        LobbyPlayer.objects.filter(lobby=lobby, user_id=body.user_id).delete()

        remaining = lobby.players.count()

        if str(lobby.host_user_id) == body.user_id:
            # Host left — cancel the lobby
            lobby.status = Lobby.Status.CANCELLED
            lobby.save(update_fields=["status"])
        elif remaining == 0:
            lobby.status = Lobby.Status.CANCELLED
            lobby.save(update_fields=["status"])
        else:
            # Non-host left — revert to waiting so new players can join
            # Reset human ready states (bots stay ready)
            lobby.status = Lobby.Status.WAITING
            lobby.full_at = None
            lobby.save(update_fields=["status", "full_at"])
            lobby.players.filter(is_bot=False).update(is_ready=False)

        return {
            "status": lobby.status,
            "cancelled": lobby.status == Lobby.Status.CANCELLED,
        }

    @route.post("/set-ready/")
    def set_ready(self, request, body: SetReadyRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Lobby, LobbyPlayer

        try:
            lobby = Lobby.objects.get(id=body.lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        updated = LobbyPlayer.objects.filter(lobby=lobby, user_id=body.user_id).update(is_ready=body.is_ready)

        if updated == 0:
            return self.create_response({"error": "Player not in lobby"}, status_code=404)

        # When a human readies up, auto-ready all bots in the lobby
        if body.is_ready:
            lobby.players.filter(is_bot=True).update(is_ready=True)

        players = list(lobby.players.select_related("user").all())

        if lobby.status == Lobby.Status.FULL and all(p.is_ready for p in players):
            lobby.status = Lobby.Status.READY
            lobby.save(update_fields=["status"])

        return {
            "all_ready": lobby.status == Lobby.Status.READY,
            "players": [_lobby_player_dict(p) for p in players],
        }

    @route.post("/fill-bots/")
    def fill_lobby_bots(self, request, body: FillLobbyBotsRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        import random

        from apps.accounts.models import User
        from apps.matchmaking.models import Lobby, LobbyPlayer

        try:
            lobby = Lobby.objects.get(id=body.lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        current_count = lobby.players.count()
        needed = lobby.max_players - current_count
        if needed <= 0:
            players = list(lobby.players.select_related("user").all())
            return {"bot_ids": [], "players": [_lobby_player_dict(p) for p in players]}

        existing_user_ids = list(lobby.players.values_list("user_id", flat=True))
        available_bots = list(
            User.objects.filter(is_bot=True).exclude(id__in=existing_user_ids).values_list("id", flat=True)
        )
        random.shuffle(available_bots)
        chosen_bot_ids = available_bots[:needed]

        for bot_id in chosen_bot_ids:
            LobbyPlayer.objects.get_or_create(
                lobby=lobby,
                user_id=bot_id,
                defaults={"is_bot": True, "is_ready": True},
            )

        players = list(lobby.players.select_related("user").all())
        player_count = len(players)

        if player_count >= lobby.max_players:
            from django.utils import timezone as tz

            if all(p.is_ready for p in players):
                lobby.status = Lobby.Status.READY
            else:
                lobby.status = Lobby.Status.FULL
            if not lobby.full_at:
                lobby.full_at = tz.now()
            lobby.save(update_fields=["status", "full_at"])

        return {
            "bot_ids": [str(bid) for bid in chosen_bot_ids],
            "players": [_lobby_player_dict(p) for p in players],
        }

    @route.post("/start-match/")
    def start_match(self, request, body: StartMatchFromLobbyRequest):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Lobby, MatchQueue

        try:
            lobby = Lobby.objects.select_related("game_mode").get(id=body.lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        if lobby.status != Lobby.Status.READY:
            return self.create_response({"error": "Lobby is not ready"}, status_code=400)

        lobby.status = Lobby.Status.STARTING
        lobby.save(update_fields=["status"])

        lobby_players = list(lobby.players.select_related("user").all())
        users = [lp.user for lp in lobby_players]
        # Build user_id -> team_label mapping for team-based modes (None values ignored later)
        team_labels = {str(lp.user_id): lp.team_label for lp in lobby_players if lp.team_label}

        result = _create_match_from_users(users, lobby.game_mode, team_labels=team_labels or None)

        # Link match back to the lobby
        from apps.matchmaking.models import Match

        match = Match.objects.get(id=result["match_id"])
        lobby.match = match
        lobby.save(update_fields=["match"])

        # Clean up any MatchQueue entries for these users
        user_ids = [u.id for u in users]
        MatchQueue.objects.filter(user_id__in=user_ids).delete()

        return result

    @route.get("/get/{lobby_id}/")
    def get_lobby(self, request, lobby_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Lobby

        try:
            lobby = Lobby.objects.select_related("game_mode", "host_user").get(id=lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        players = list(lobby.players.select_related("user").all())

        return {
            "lobby_id": str(lobby.id),
            "status": lobby.status,
            "max_players": lobby.max_players,
            "game_mode": lobby.game_mode.slug if lobby.game_mode else None,
            "host_user_id": str(lobby.host_user_id),
            "players": [_lobby_player_dict(p) for p in players],
            "full_at": lobby.full_at.timestamp() if lobby.full_at else None,
            "created_at": lobby.created_at.timestamp(),
        }

    @route.get("/active/{user_id}/")
    def get_active_lobby(self, request, user_id: str):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from apps.matchmaking.models import Lobby, LobbyPlayer

        lp = (
            LobbyPlayer.objects.filter(
                user_id=user_id,
                lobby__status__in=(
                    Lobby.Status.WAITING,
                    Lobby.Status.FULL,
                    Lobby.Status.READY,
                ),
            )
            .select_related("lobby")
            .first()
        )

        return {"lobby_id": str(lp.lobby_id) if lp else None}

    @route.get("/find-waiting/")
    def find_waiting_lobby(self, request, game_mode: str | None = None):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.db.models import Count, F

        from apps.game_config.models import GameMode
        from apps.matchmaking.models import Lobby

        gm = None
        if game_mode:
            gm = GameMode.objects.filter(slug=game_mode, is_active=True).first()
        else:
            gm = GameMode.objects.filter(is_default=True, is_active=True).first()

        lobby = (
            Lobby.objects.filter(status=Lobby.Status.WAITING, game_mode=gm)
            .annotate(player_count=Count("players"))
            .filter(player_count__lt=F("max_players"))
            .order_by("created_at")
            .first()
        )

        return {"lobby_id": str(lobby.id) if lobby else None}

    @route.post("/find-or-create/")
    def find_or_create_lobby(self, request, body: CreateLobbyRequest):
        """Atomically find a waiting lobby and join it, or create a new one."""
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        from django.db import transaction
        from django.db.models import Count, F, Subquery

        from apps.accounts.models import User
        from apps.game_config.models import GameMode, GameSettings
        from apps.matchmaking.models import Lobby, LobbyPlayer

        try:
            user = User.objects.get(id=body.user_id)
        except User.DoesNotExist:
            return self.create_response({"error": "User not found"}, status_code=404)

        gm = None
        if body.game_mode:
            gm = GameMode.objects.filter(slug=body.game_mode, is_active=True).first()
        else:
            gm = GameMode.objects.filter(is_default=True, is_active=True).first()

        with transaction.atomic():
            # Find candidate IDs first (with GROUP BY), then lock the row
            candidate_ids = (
                Lobby.objects.filter(status=Lobby.Status.WAITING, game_mode=gm)
                .annotate(player_count=Count("players"))
                .filter(player_count__lt=F("max_players"))
                .order_by("created_at")
                .values_list("id", flat=True)[:1]
            )

            # Lock the specific row (no GROUP BY here)
            lobby = Lobby.objects.select_for_update(skip_locked=True).filter(id__in=Subquery(candidate_ids)).first()

            if lobby:
                # Verify it still has space (another concurrent request might have filled it)
                if lobby.players.count() >= lobby.max_players:
                    lobby = None

            if lobby:
                LobbyPlayer.objects.get_or_create(
                    lobby=lobby,
                    user=user,
                    defaults={"is_bot": user.is_bot},
                )
                player_count = lobby.players.count()
                if player_count >= lobby.max_players:
                    from django.utils import timezone as tz

                    lobby.status = Lobby.Status.FULL
                    lobby.full_at = tz.now()
                    lobby.save(update_fields=["status", "full_at"])

                players = list(lobby.players.select_related("user").all())
                return {
                    "lobby_id": str(lobby.id),
                    "max_players": lobby.max_players,
                    "status": lobby.status,
                    "created": False,
                    "players": [_lobby_player_dict(p) for p in players],
                    "full_at": lobby.full_at.timestamp() if lobby.full_at else None,
                }
            else:
                max_players = gm.max_players if gm else GameSettings.get().max_players

                lobby = Lobby.objects.create(
                    host_user=user,
                    game_mode=gm,
                    max_players=max_players,
                )
                LobbyPlayer.objects.create(lobby=lobby, user=user, is_bot=user.is_bot)

                players = list(lobby.players.select_related("user").all())
                return {
                    "lobby_id": str(lobby.id),
                    "max_players": lobby.max_players,
                    "status": lobby.status,
                    "created": True,
                    "players": [_lobby_player_dict(p) for p in players],
                    "full_at": None,
                }

    @route.post("/notify-lobby-full/")
    def notify_lobby_full(self, request):
        if not check_internal_secret(request):
            return self.create_response({"error": "Unauthorized"}, status_code=403)

        import json as _json

        body = _json.loads(request.body)
        lobby_id = body.get("lobby_id")
        if not lobby_id:
            return self.create_response({"error": "lobby_id required"}, status_code=400)

        from apps.matchmaking.models import Lobby

        try:
            lobby = Lobby.objects.prefetch_related("players__user").get(id=lobby_id)
        except Lobby.DoesNotExist:
            return self.create_response({"error": "Lobby not found"}, status_code=404)

        human_ids = [str(lp.user_id) for lp in lobby.players.all() if not lp.is_bot]

        if human_ids:
            from apps.accounts.push import send_push_to_users

            send_push_to_users(
                human_ids,
                title="Lobby pełne!",
                body="Wszyscy gracze dołączyli. Zaakceptuj gotowość!",
                url=f"/lobby/{lobby_id}",
                tag=f"lobby-full-{lobby_id}",
            )

        return {"ok": True, "notified": len(human_ids)}
