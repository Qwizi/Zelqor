import random
from collections import deque
from collections.abc import Callable

DEFAULT_UNIT_TYPES = {
    "infantry": {
        "attack": 1.0,
        "defense": 1.0,
        "speed": 1,
        "attack_range": 1,
        "sea_hop_distance_km": 0,
        "movement_type": "land",
        "production_cost": 0,
        "production_time_ticks": 0,
        "produced_by_slug": None,
        "manpower_cost": 1,
    },
    "tank": {
        "attack": 3.0,
        "defense": 2.5,
        "speed": 1,
        "attack_range": 1,
        "sea_hop_distance_km": 0,
        "movement_type": "land",
        "production_cost": 15,
        "production_time_ticks": 8,
        "produced_by_slug": "factory",
        "manpower_cost": 3,
    },
    "ship": {
        "attack": 2.0,
        "defense": 2.0,
        "speed": 4,
        "attack_range": 4,
        "sea_hop_distance_km": 2800,
        "movement_type": "sea",
        "production_cost": 20,
        "production_time_ticks": 10,
        "produced_by_slug": "port",
        "manpower_cost": 10,
    },
    "fighter": {
        "attack": 2.5,
        "defense": 1.0,
        "speed": 3,
        "attack_range": 3,
        "sea_hop_distance_km": 0,
        "movement_type": "air",
        "production_cost": 25,
        "production_time_ticks": 12,
        "produced_by_slug": "carrier",
        "manpower_cost": 10,
    },
}


class GameEngine:
    """Pure game logic — processes ticks, combat, economy, and production."""

    def __init__(self, settings: dict, neighbor_map: dict):
        self.settings = settings
        self.neighbor_map = neighbor_map

    def process_tick(
        self,
        players: dict,
        regions: dict,
        actions: list,
        buildings_queue: list,
        unit_queue: list,
        transit_queue: list,
    ) -> dict:
        events = []

        events.extend(self._generate_currency(players, regions))
        events.extend(self._generate_units(regions))

        buildings_queue, build_events = self._process_buildings(regions, buildings_queue)
        events.extend(build_events)

        unit_queue, unit_events = self._process_unit_queue(regions, unit_queue)
        events.extend(unit_events)

        transit_queue, transit_events = self._process_transit_queue(players, regions, transit_queue)
        events.extend(transit_events)

        for action in actions:
            events.extend(
                self._process_action(action, players, regions, buildings_queue, unit_queue, transit_queue)
            )

        events.extend(self._check_conditions(players, regions))

        return {
            "players": players,
            "regions": regions,
            "buildings_queue": buildings_queue,
            "unit_queue": unit_queue,
            "transit_queue": transit_queue,
            "events": events,
        }

    def _generate_currency(self, players: dict, regions: dict) -> list:
        base_currency = float(self.settings.get("base_currency_per_tick", 2.0))
        region_currency = float(self.settings.get("region_currency_per_tick", 0.35))

        owned_regions_by_player: dict[str, list[dict]] = {}
        for region in regions.values():
            owner_id = region.get("owner_id")
            if not owner_id:
                continue
            owned_regions_by_player.setdefault(owner_id, []).append(region)

        for player_id, player in players.items():
            owned_regions = owned_regions_by_player.get(player_id, [])
            passive_bonus = sum(
                float(region.get("currency_generation_bonus", 0.0))
                for region in owned_regions
            )
            income = base_currency + len(owned_regions) * region_currency + passive_bonus
            player["currency_accum"] = player.get("currency_accum", 0.0) + income
            whole = int(player["currency_accum"])
            if whole > 0:
                player["currency"] = int(player.get("currency", 0)) + whole
                player["currency_accum"] -= whole

        return []

    def _generate_units(self, regions: dict) -> list:
        base_rate = float(self.settings.get("base_unit_generation_rate", 1.0))
        capital_bonus = float(self.settings.get("capital_generation_bonus", 2.0))
        default_unit_type = self.settings.get("default_unit_type_slug", "infantry")

        for region in regions.values():
            if not region.get("owner_id"):
                continue

            rate = base_rate
            if region.get("is_capital"):
                rate *= capital_bonus
            rate += float(region.get("unit_generation_bonus", 0.0))

            region["unit_accum"] = region.get("unit_accum", 0.0) + rate
            whole = int(region["unit_accum"])
            if whole > 0:
                self._add_units(region, default_unit_type, whole)
                region["unit_accum"] -= whole

        return []

    def _process_buildings(self, regions: dict, buildings_queue: list) -> tuple[list, list]:
        events = []
        remaining = []

        for building in buildings_queue:
            building["ticks_remaining"] = building.get("ticks_remaining", 0) - 1
            if building["ticks_remaining"] > 0:
                remaining.append(building)
                continue

            region_id = building["region_id"]
            region = regions.get(region_id)
            if not region:
                continue

            region_buildings = dict(region.get("buildings") or {})
            region_buildings[building["building_type"]] = (
                int(region_buildings.get(building["building_type"], 0)) + 1
            )
            region["buildings"] = region_buildings
            self._recompute_region_building_stats(region)

            events.append({
                "type": "building_complete",
                "region_id": region_id,
                "building_type": building["building_type"],
                "player_id": building["player_id"],
                "building_count": region_buildings[building["building_type"]],
            })

        return remaining, events

    def _process_unit_queue(self, regions: dict, unit_queue: list) -> tuple[list, list]:
        events = []
        remaining = []

        for item in unit_queue:
            item["ticks_remaining"] = item.get("ticks_remaining", 0) - 1
            if item["ticks_remaining"] > 0:
                remaining.append(item)
                continue

            region = regions.get(item["region_id"])
            if not region or region.get("owner_id") != item.get("player_id"):
                continue

            base_unit_type = self.settings.get("default_unit_type_slug", "infantry")
            manpower_cost = int(item.get("manpower_cost", self._get_unit_scale(item["unit_type"])))
            total_manpower = manpower_cost * int(item.get("quantity", 1))
            if self._get_available_units(region, base_unit_type) < total_manpower:
                events.append({
                    "type": "unit_production_failed",
                    "region_id": item["region_id"],
                    "unit_type": item["unit_type"],
                    "player_id": item["player_id"],
                    "quantity": item.get("quantity", 1),
                    "message": "Za malo piechoty do finalizacji produkcji",
                })
                continue

            self._add_units(region, item["unit_type"], int(item.get("quantity", 1)))
            events.append({
                "type": "unit_production_complete",
                "region_id": item["region_id"],
                "unit_type": item["unit_type"],
                "player_id": item["player_id"],
                "quantity": item.get("quantity", 1),
            })

        return remaining, events

    def _process_transit_queue(self, players: dict, regions: dict, transit_queue: list) -> tuple[list, list]:
        events = []
        remaining = []

        for item in transit_queue:
            item["ticks_remaining"] = item.get("ticks_remaining", 0) - 1
            if item["ticks_remaining"] > 0:
                remaining.append(item)
                continue

            if item.get("action_type") == "move":
                events.extend(self._resolve_move_arrival(item, regions))
            elif item.get("action_type") == "attack":
                events.extend(self._resolve_attack_arrival(item, players, regions))

        return remaining, events

    def _process_action(
        self,
        action: dict,
        players: dict,
        regions: dict,
        buildings_queue: list,
        unit_queue: list,
        transit_queue: list,
    ) -> list:
        action_type = action.get("action_type")
        if action_type == "attack":
            return self._process_attack(action, players, regions, transit_queue)
        if action_type == "move":
            return self._process_move(action, regions, transit_queue)
        if action_type == "build":
            return self._process_build(action, players, regions, buildings_queue)
        if action_type == "produce_unit":
            return self._process_unit_production(action, players, regions, unit_queue)
        return []

    def _process_attack(self, action: dict, players: dict, regions: dict, transit_queue: list) -> list:
        events = []
        source_id = action.get("source_region_id")
        target_id = action.get("target_region_id")
        units = int(action.get("units", 0))
        player_id = action.get("player_id")

        source = regions.get(source_id)
        target = regions.get(target_id)
        if not source or not target:
            return events
        if source.get("owner_id") != player_id:
            return events
        unit_type = action.get("unit_type") or self._get_region_unit_type(source)
        if units <= 0 or self._get_available_units(source, unit_type) < units:
            return events
        if target.get("owner_id") == player_id:
            return [self._reject_action(player_id, "Nie mozesz atakowac wlasnego regionu", action)]

        unit_config = self._get_unit_config(unit_type)
        attack_range = max(1, int(unit_config.get("attack_range", 1)))
        distance = self._get_travel_distance(
            source_id,
            target_id,
            regions,
            unit_config,
            max_depth=attack_range,
            player_id=None,
        )
        if distance is None:
            return [self._reject_action(player_id, self._attack_rejection_message(unit_config), action)]

        self._deploy_units_from_region(source, unit_type, units)
        travel_ticks = self._get_travel_ticks(distance, unit_config)
        transit_queue.append({
            "action_type": "attack",
            "source_region_id": source_id,
            "target_region_id": target_id,
            "player_id": player_id,
            "unit_type": unit_type,
            "units": units,
            "ticks_remaining": travel_ticks,
            "travel_ticks": travel_ticks,
        })
        return [{
            "type": "troops_sent",
            "action_type": "attack",
            "source_region_id": source_id,
            "target_region_id": target_id,
            "player_id": player_id,
            "units": units,
            "unit_type": unit_type,
            "travel_ticks": travel_ticks,
        }]

    def _process_move(self, action: dict, regions: dict, transit_queue: list) -> list:
        source_id = action.get("source_region_id")
        target_id = action.get("target_region_id")
        units = int(action.get("units", 0))
        player_id = action.get("player_id")

        source = regions.get(source_id)
        target = regions.get(target_id)
        if not source or not target:
            return []
        if source.get("owner_id") != player_id or target.get("owner_id") != player_id:
            return [self._reject_action(player_id, "Mozesz przemieszczac wojska tylko miedzy swoimi regionami", action)]
        unit_type = action.get("unit_type") or self._get_region_unit_type(source)
        if units <= 0 or self._get_available_units(source, unit_type) < units:
            return []
        unit_config = self._get_unit_config(unit_type)
        speed = max(1, int(unit_config.get("speed", 1)))
        move_range = max(speed, int(unit_config.get("attack_range", 1)))

        distance = self._get_travel_distance(
            source_id,
            target_id,
            regions,
            unit_config,
            max_depth=move_range,
            player_id=player_id,
        )
        if distance is None:
            return [self._reject_action(player_id, self._move_rejection_message(unit_config), action)]

        self._deploy_units_from_region(source, unit_type, units)
        travel_ticks = self._get_travel_ticks(distance, unit_config)
        transit_queue.append({
            "action_type": "move",
            "source_region_id": source_id,
            "target_region_id": target_id,
            "player_id": player_id,
            "unit_type": unit_type,
            "units": units,
            "ticks_remaining": travel_ticks,
            "travel_ticks": travel_ticks,
        })
        return [{
            "type": "troops_sent",
            "action_type": "move",
            "source_region_id": source_id,
            "target_region_id": target_id,
            "units": units,
            "unit_type": unit_type,
            "player_id": player_id,
            "travel_ticks": travel_ticks,
        }]

    def _process_build(self, action: dict, players: dict, regions: dict, buildings_queue: list) -> list:
        region_id = action.get("region_id")
        building_type = action.get("building_type")
        player_id = action.get("player_id")

        player = players.get(player_id)
        region = regions.get(region_id)
        if not player or not region:
            return []
        if region.get("owner_id") != player_id:
            return []

        building_configs = self.settings.get("building_types", {})
        config = building_configs.get(building_type)
        if not config:
            return [self._reject_action(player_id, "Nieznany typ budynku", action)]

        if config.get("requires_coastal") and not region.get("is_coastal"):
            return [self._reject_action(player_id, "Ten budynek mozna postawic tylko w regionie przybrzeznym", action)]

        current_count = int((region.get("buildings") or {}).get(building_type, 0))
        queued_count = sum(
            1
            for queued in buildings_queue
            if queued.get("region_id") == region_id and queued.get("building_type") == building_type
        )
        max_per_region = int(config.get("max_per_region", 1))
        if current_count + queued_count >= max_per_region:
            return [self._reject_action(player_id, "Osiagnieto limit tego budynku w regionie", action)]

        currency_cost = int(config.get("currency_cost", config.get("cost", 30)))
        if int(player.get("currency", 0)) < currency_cost:
            return [self._reject_action(player_id, "Za malo waluty na budowe", action)]

        player["currency"] = int(player.get("currency", 0)) - currency_cost
        build_time = int(config.get("build_time_ticks", 10))
        buildings_queue.append({
            "region_id": region_id,
            "building_type": building_type,
            "player_id": player_id,
            "ticks_remaining": build_time,
            "total_ticks": build_time,
        })

        return [{
            "type": "build_started",
            "region_id": region_id,
            "building_type": building_type,
            "player_id": player_id,
            "ticks_remaining": build_time,
            "currency_cost": currency_cost,
        }]

    def _process_unit_production(self, action: dict, players: dict, regions: dict, unit_queue: list) -> list:
        region_id = action.get("region_id")
        unit_type = action.get("unit_type")
        player_id = action.get("player_id")

        player = players.get(player_id)
        region = regions.get(region_id)
        if not player or not region:
            return []
        if region.get("owner_id") != player_id:
            return []

        unit_config = self._get_unit_config(unit_type)
        produced_by_slug = unit_config.get("produced_by_slug")
        if not produced_by_slug:
            return [self._reject_action(player_id, "Ten typ jednostki nie wymaga produkcji specjalnej", action)]

        buildings = region.get("buildings") or {}
        if int(buildings.get(produced_by_slug, 0)) < 1:
            return [self._reject_action(player_id, "Ten region nie ma wymaganej infrastruktury", action)]

        if unit_config.get("movement_type") == "sea" and not region.get("is_coastal"):
            return [self._reject_action(player_id, "Statki mozna produkowac tylko w regionie przybrzeznym", action)]

        production_cost = int(unit_config.get("production_cost", 0))
        if int(player.get("currency", 0)) < production_cost:
            return [self._reject_action(player_id, "Za malo waluty na produkcje jednostki", action)]

        manpower_cost = int(unit_config.get("manpower_cost", 1))
        base_unit_type = self.settings.get("default_unit_type_slug", "infantry")
        if self._get_available_units(region, base_unit_type) < manpower_cost:
            return [self._reject_action(player_id, "Za malo piechoty w regionie do zalogi tej jednostki", action)]

        player["currency"] = int(player.get("currency", 0)) - production_cost
        production_time = int(unit_config.get("production_time_ticks", 1))
        unit_queue.append({
            "region_id": region_id,
            "player_id": player_id,
            "unit_type": unit_type,
            "quantity": 1,
            "manpower_cost": manpower_cost,
            "ticks_remaining": production_time,
            "total_ticks": production_time,
        })

        return [{
            "type": "unit_production_started",
            "region_id": region_id,
            "player_id": player_id,
            "unit_type": unit_type,
            "quantity": 1,
            "ticks_remaining": production_time,
            "currency_cost": production_cost,
            "manpower_cost": manpower_cost,
        }]

    def _recompute_region_building_stats(self, region: dict) -> None:
        building_configs = self.settings.get("building_types", {})
        buildings = region.get("buildings") or {}

        defense_bonus = 0.0
        vision_range = 0
        unit_generation_bonus = 0.0
        currency_generation_bonus = 0.0
        primary_slug = None
        primary_order = 10**9

        for slug, raw_count in buildings.items():
            count = int(raw_count or 0)
            if count <= 0:
                continue
            config = building_configs.get(slug, {})
            defense_bonus += float(config.get("defense_bonus", 0.0)) * count
            vision_range += int(config.get("vision_range", 0)) * count
            unit_generation_bonus += float(config.get("unit_generation_bonus", 0.0)) * count
            currency_generation_bonus += float(config.get("currency_generation_bonus", 0.0)) * count
            order = int(config.get("order", 9999))
            if primary_slug is None or order < primary_order:
                primary_slug = slug
                primary_order = order

        region["building_type"] = primary_slug
        region["defense_bonus"] = defense_bonus
        region["vision_range"] = vision_range
        region["unit_generation_bonus"] = unit_generation_bonus
        region["currency_generation_bonus"] = currency_generation_bonus

    def _resolve_move_arrival(self, item: dict, regions: dict) -> list:
        source_id = item.get("source_region_id")
        target_id = item.get("target_region_id")
        player_id = item.get("player_id")
        unit_type = item.get("unit_type")
        units = int(item.get("units", 0))

        target = regions.get(target_id)
        if not target or target.get("owner_id") != player_id:
            source = regions.get(source_id)
            if source:
                self._receive_units_in_region(source, unit_type, units)
            return [{
                "type": "action_rejected",
                "player_id": player_id,
                "message": "Cel ruchu nie jest juz dostepny",
                "action_type": "move",
                "source_region_id": source_id,
                "target_region_id": target_id,
                "unit_type": unit_type,
            }]

        self._receive_units_in_region(target, unit_type, units)
        return [{
            "type": "units_moved",
            "source_region_id": source_id,
            "target_region_id": target_id,
            "units": units,
            "unit_type": unit_type,
            "player_id": player_id,
        }]

    def _resolve_attack_arrival(self, item: dict, players: dict, regions: dict) -> list:
        events = []
        source_id = item.get("source_region_id")
        target_id = item.get("target_region_id")
        player_id = item.get("player_id")
        unit_type = item.get("unit_type")
        units = int(item.get("units", 0))

        target = regions.get(target_id)
        if not target:
            source = regions.get(source_id)
            if source:
                self._receive_units_in_region(source, unit_type, units)
            return events
        if target.get("owner_id") == player_id:
            self._receive_units_in_region(target, unit_type, units)
            return [{
                "type": "units_moved",
                "source_region_id": source_id,
                "target_region_id": target_id,
                "units": units,
                "unit_type": unit_type,
                "player_id": player_id,
            }]

        unit_config = self._get_unit_config(unit_type)
        attacker_bonus = float(self.settings.get("attacker_advantage", 0))
        defender_bonus = float(self.settings.get("defender_advantage", 0.1))
        defense_building = float(target.get("defense_bonus", 0))
        randomness = float(self.settings.get("combat_randomness", 0.2))

        attacker_attack = float(unit_config.get("attack", 1.0))
        attacker_power = units * self._get_unit_scale(unit_type) * attacker_attack * (1 + attacker_bonus)
        defender_power = self._get_region_defender_power(target, defender_bonus + defense_building)

        attacker_roll = attacker_power * (1 + random.uniform(-randomness, randomness))
        defender_roll = defender_power * (1 + random.uniform(-randomness, randomness))

        if attacker_roll > defender_roll:
            surviving_effective = max(
                self._get_unit_scale(unit_type),
                int(units * self._get_unit_scale(unit_type) * (1 - defender_power / max(attacker_power, 1) * 0.5)),
            )
            surviving = max(1, int(round(surviving_effective / self._get_unit_scale(unit_type))))
            old_owner = target.get("owner_id")
            target["owner_id"] = player_id
            target["units"] = {}
            self._receive_units_in_region(target, unit_type, surviving)

            events.append({
                "type": "attack_success",
                "source_region_id": source_id,
                "target_region_id": target_id,
                "player_id": player_id,
                "units": units,
                "unit_type": unit_type,
                "old_owner_id": old_owner,
                "surviving_units": surviving,
            })

            if target.get("is_capital") and old_owner:
                target["is_capital"] = False
                events.append({
                    "type": "capital_captured",
                    "region_id": target_id,
                    "captured_by": player_id,
                    "lost_by": old_owner,
                })
        else:
            remaining_ratio = max(0.0, 1 - attacker_power / max(defender_power, 1) * 0.5)
            reduced_units: dict[str, int] = {}
            for defender_unit_type, count in (target.get("units") or {}).items():
                remaining_count = max(0, int(count * remaining_ratio))
                if remaining_count > 0:
                    reduced_units[defender_unit_type] = remaining_count
            target["units"] = reduced_units
            self._sync_region_unit_meta(target)
            surviving_defenders = target.get("unit_count", 0)
            events.append({
                "type": "attack_failed",
                "source_region_id": source_id,
                "target_region_id": target_id,
                "player_id": player_id,
                "units": units,
                "unit_type": unit_type,
                "defender_surviving": surviving_defenders,
            })

        return events

    def _get_region_unit_type(self, region: dict) -> str:
        units = region.get("units") or {}
        if units:
            base_unit_type = self._get_base_unit_type()
            return max(
                units.items(),
                key=lambda item: (
                    self._get_available_base_units(region)
                    if item[0] == base_unit_type
                    else int(item[1]) * self._get_unit_scale(item[0])
                ),
            )[0]
        return region.get("unit_type") or self.settings.get("default_unit_type_slug", "infantry")

    def _get_available_units(self, region: dict, unit_type: str | None) -> int:
        units = region.get("units") or {}
        base_unit_type = self._get_base_unit_type()
        if unit_type == base_unit_type:
            return self._get_available_base_units(region)
        if unit_type and unit_type in units:
            return int(units.get(unit_type, 0))
        return 0

    def _add_units(self, region: dict, unit_type: str, amount: int) -> None:
        if amount <= 0:
            return
        units = dict(region.get("units") or {})
        units[unit_type] = int(units.get(unit_type, 0)) + amount
        region["units"] = units
        self._sync_region_unit_meta(region)

    def _remove_units(self, region: dict, unit_type: str, amount: int) -> None:
        if amount <= 0:
            return
        units = dict(region.get("units") or {})
        remaining = int(units.get(unit_type, 0)) - amount
        if remaining > 0:
            units[unit_type] = remaining
        else:
            units.pop(unit_type, None)
        region["units"] = units
        self._sync_region_unit_meta(region)

    def _sync_region_unit_meta(self, region: dict) -> None:
        units = region.get("units") or {}
        base_unit_type = self._get_base_unit_type()
        region["unit_count"] = 0
        for unit_type, count in units.items():
            if unit_type == base_unit_type:
                region["unit_count"] += self._get_available_base_units(region)
            else:
                region["unit_count"] += int(count) * self._get_unit_scale(unit_type)
        region["unit_type"] = self._get_region_unit_type(region) if units else None

    def _normalize_stationed_units(self, region: dict) -> None:
        units = dict(region.get("units") or {})
        if not units:
            return

        buildings = region.get("buildings") or {}
        normalized: dict[str, int] = {}

        for unit_type, count in units.items():
            if self._can_station_unit(region, unit_type, buildings):
                normalized[unit_type] = normalized.get(unit_type, 0) + int(count)

        region["units"] = normalized

    def _can_station_unit(self, region: dict, unit_type: str, buildings: dict | None = None) -> bool:
        unit_config = self._get_unit_config(unit_type)
        produced_by_slug = unit_config.get("produced_by_slug")
        if not produced_by_slug:
            return True

        if unit_config.get("movement_type") == "sea" and not region.get("is_coastal"):
            return False

        region_buildings = buildings if buildings is not None else (region.get("buildings") or {})
        return int(region_buildings.get(produced_by_slug, 0)) > 0

    def _get_region_defender_power(self, region: dict, defense_bonus: float) -> float:
        total = 0.0
        base_unit_type = self._get_base_unit_type()
        for unit_type, count in (region.get("units") or {}).items():
            unit_config = self._get_unit_config(unit_type)
            effective_count = (
                self._get_available_base_units(region)
                if unit_type == base_unit_type
                else int(count) * self._get_unit_scale(unit_type)
            )
            total += (
                effective_count
                * float(unit_config.get("defense", 1.0))
                * (1 + defense_bonus)
            )
        if total > 0:
            return total
        fallback_config = self._get_unit_config(self._get_region_unit_type(region))
        return region.get("unit_count", 0) * float(fallback_config.get("defense", 1.0)) * (1 + defense_bonus)

    def _get_unit_config(self, unit_type: str | None) -> dict:
        unit_key = unit_type or self.settings.get("default_unit_type_slug", "infantry")
        configured = self.settings.get("unit_types", {}).get(unit_key)
        if configured:
            return configured
        return DEFAULT_UNIT_TYPES.get(unit_key, DEFAULT_UNIT_TYPES["infantry"])

    def _get_unit_scale(self, unit_type: str | None) -> int:
        unit_config = self._get_unit_config(unit_type)
        return max(1, int(unit_config.get("manpower_cost", 1)))

    def _get_travel_ticks(self, distance: int, unit_config: dict) -> int:
        speed = max(1, int(unit_config.get("speed", 1)))
        return max(1, (max(1, distance) + speed - 1) // speed)

    def _get_base_unit_type(self) -> str:
        return self.settings.get("default_unit_type_slug", "infantry")

    def _get_reserved_base_units(self, region: dict) -> int:
        base_unit_type = self._get_base_unit_type()
        reserved = 0
        for unit_type, count in (region.get("units") or {}).items():
            if unit_type == base_unit_type:
                continue
            reserved += int(count) * self._get_unit_scale(unit_type)
        return reserved

    def _get_available_base_units(self, region: dict) -> int:
        units = region.get("units") or {}
        base_unit_type = self._get_base_unit_type()
        raw_base_units = int(units.get(base_unit_type, 0))
        return max(0, raw_base_units - self._get_reserved_base_units(region))

    def _is_embarked_unit(self, unit_type: str | None) -> bool:
        if not unit_type:
            return False
        return unit_type != self._get_base_unit_type() and self._get_unit_scale(unit_type) > 1

    def _deploy_units_from_region(self, region: dict, unit_type: str, amount: int) -> None:
        self._remove_units(region, unit_type, amount)
        if self._is_embarked_unit(unit_type):
            self._remove_units(region, self._get_base_unit_type(), amount * self._get_unit_scale(unit_type))

    def _receive_units_in_region(self, region: dict, unit_type: str, amount: int) -> None:
        if self._is_embarked_unit(unit_type):
            self._add_units(region, self._get_base_unit_type(), amount * self._get_unit_scale(unit_type))
        self._add_units(region, unit_type, amount)
        self._normalize_stationed_units(region)
        self._sync_region_unit_meta(region)

    def _can_travel(
        self,
        source_id: str,
        target_id: str,
        regions: dict,
        unit_config: dict,
        max_depth: int,
        player_id: str | None,
    ) -> bool:
        if source_id == target_id:
            return False

        movement_type = unit_config.get("movement_type", "land")
        if movement_type == "sea":
            return self._can_travel_sea(source_id, target_id, regions, player_id, max_depth, unit_config)

        distance = self._get_distance(
            source_id,
            target_id,
            max_depth=max_depth,
            can_visit=lambda region_id: self._can_visit_region(
                region_id,
                regions,
                movement_type=movement_type,
                player_id=player_id,
                target_id=target_id,
            ),
        )
        return distance is not None

    def _get_travel_distance(
        self,
        source_id: str,
        target_id: str,
        regions: dict,
        unit_config: dict,
        max_depth: int,
        player_id: str | None,
    ) -> int | None:
        if source_id == target_id:
            return None

        movement_type = unit_config.get("movement_type", "land")
        if movement_type == "sea":
            return self._get_sea_distance(source_id, target_id, regions, max_depth, unit_config)

        return self._get_distance(
            source_id,
            target_id,
            max_depth=max_depth,
            can_visit=lambda region_id: self._can_visit_region(
                region_id,
                regions,
                movement_type=movement_type,
                player_id=player_id,
                target_id=target_id,
            ),
        )

    def _can_travel_sea(
        self,
        source_id: str,
        target_id: str,
        regions: dict,
        player_id: str | None,
        max_depth: int,
        unit_config: dict,
    ) -> bool:
        source = regions.get(source_id)
        target = regions.get(target_id)
        if not source or not target:
            return False
        if not source.get("is_coastal") or not target.get("is_coastal"):
            return False
        distance = self._get_sea_distance(source_id, target_id, regions, max_depth, unit_config)
        return distance is not None

    def _get_sea_distance(
        self,
        source_id: str,
        target_id: str,
        regions: dict,
        max_depth: int,
        unit_config: dict,
    ) -> int | None:
        source = regions.get(source_id)
        target = regions.get(target_id)
        if not source or not target:
            return None
        if not source.get("is_coastal") or not target.get("is_coastal"):
            return None

        max_sea_range = max(
            1,
            int(
                unit_config.get(
                    "sea_range",
                    unit_config.get("sea_hop_distance_km", 0),
                )
                or 0
            ),
        )

        distance_score = self._get_region_sea_distance_score(source, target_id)
        if distance_score is None or distance_score > max_sea_range:
            return None

        return max(1, (distance_score + 19) // 20)

    def _get_region_sea_distance_score(self, source: dict, target_id: str) -> int | None:
        for band in source.get("sea_distances") or []:
            provinces = band.get("provinces") or []
            if target_id in provinces:
                return int(band.get("r", 0))
        return None

    def _get_distance(
        self,
        source_id: str,
        target_id: str,
        max_depth: int,
        can_visit: Callable[[str], bool],
    ) -> int | None:
        visited = {source_id}
        queue = deque([(source_id, 0)])

        while queue:
            current, depth = queue.popleft()
            if current == target_id:
                return depth
            if depth >= max_depth:
                continue

            for neighbor in self.neighbor_map.get(current, []):
                if neighbor in visited or not can_visit(neighbor):
                    continue
                visited.add(neighbor)
                queue.append((neighbor, depth + 1))

        return None

    def _can_visit_region(
        self,
        region_id: str,
        regions: dict,
        movement_type: str,
        player_id: str | None,
        target_id: str,
    ) -> bool:
        region = regions.get(region_id)
        if not region:
            return False

        if movement_type == "sea" and not region.get("is_coastal"):
            return False

        # Air units can traverse over non-owned regions; only the target legality matters.
        if movement_type == "air":
            return True

        if player_id is not None and region_id != target_id and region.get("owner_id") != player_id:
            return False

        return True

    def _attack_rejection_message(self, unit_config: dict) -> str:
        movement_type = unit_config.get("movement_type", "land")
        if movement_type == "sea":
            return "Statki moga atakowac tylko regiony przybrzezne w swoim zasiegu"
        if movement_type == "air":
            return "Lotnictwo moze atakowac tylko cele w swoim zasiegu"
        return "Ta jednostka moze atakowac tylko cele w swoim zasiegu"

    def _move_rejection_message(self, unit_config: dict) -> str:
        movement_type = unit_config.get("movement_type", "land")
        if movement_type == "sea":
            return "Statki moga poruszac sie tylko miedzy przybrzeznymi regionami"
        if movement_type == "air":
            return "Lotnictwo moze przemieszczac sie tylko w swoim zasiegu"
        return "Ta jednostka moze przemieszczac sie tylko w swoim zasiegu"

    def _reject_action(self, player_id: str | None, message: str, action: dict) -> dict:
        return {
            "type": "action_rejected",
            "player_id": player_id,
            "message": message,
            "action_type": action.get("action_type"),
            "source_region_id": action.get("source_region_id"),
            "target_region_id": action.get("target_region_id"),
            "region_id": action.get("region_id"),
            "building_type": action.get("building_type"),
            "unit_type": action.get("unit_type"),
        }

    def _check_conditions(self, players: dict, regions: dict) -> list:
        events = []
        for player_id, player in players.items():
            if not player.get("is_alive"):
                continue

            capital_region_id = player.get("capital_region_id")
            if capital_region_id:
                region = regions.get(capital_region_id)
                if region and region.get("owner_id") != player_id:
                    player["is_alive"] = False
                    events.append({
                        "type": "player_eliminated",
                        "player_id": player_id,
                        "reason": "capital_lost",
                    })

        alive = [pid for pid, p in players.items() if p.get("is_alive")]
        if len(alive) <= 1:
            events.append({
                "type": "game_over",
                "winner_id": alive[0] if alive else None,
            })

        return events
