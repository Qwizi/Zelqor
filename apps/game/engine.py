import random


class GameEngine:
    """Pure game logic — processes ticks, combat, unit generation.

    All game parameters come from `settings` dict (snapshot of GameSettings).
    `neighbor_map` is {region_id: [neighbor_ids]} loaded from DB.
    """

    def __init__(self, settings: dict, neighbor_map: dict):
        self.settings = settings
        self.neighbor_map = neighbor_map

    def process_tick(
        self,
        players: dict,
        regions: dict,
        actions: list,
        buildings_queue: list,
    ) -> dict:
        """Process a single game tick. Returns updated state + events."""
        events = []

        # 1. Generate units in all owned regions
        events.extend(self._generate_units(regions))

        # 2. Advance buildings under construction
        buildings_queue, build_events = self._process_buildings(regions, buildings_queue)
        events.extend(build_events)

        # 3. Process player actions (attacks, moves, build orders)
        for action in actions:
            result = self._process_action(action, players, regions, buildings_queue)
            events.extend(result)

        # 4. Check win/lose conditions
        events.extend(self._check_conditions(players, regions))

        return {
            "players": players,
            "regions": regions,
            "buildings_queue": buildings_queue,
            "events": events,
        }

    # ------------------------------------------------------------------
    # Unit generation
    # ------------------------------------------------------------------

    def _generate_units(self, regions: dict) -> list:
        base_rate = float(self.settings.get("base_unit_generation_rate", 1.0))
        capital_bonus = float(self.settings.get("capital_generation_bonus", 2.0))

        for region in regions.values():
            if not region.get("owner_id"):
                continue

            rate = base_rate
            if region.get("is_capital"):
                rate *= capital_bonus
            rate += region.get("unit_generation_bonus", 0)

            # Accumulate fractional units
            region["unit_accum"] = region.get("unit_accum", 0.0) + rate
            whole = int(region["unit_accum"])
            if whole > 0:
                region["unit_count"] = region.get("unit_count", 0) + whole
                region["unit_accum"] -= whole

        return []

    # ------------------------------------------------------------------
    # Buildings
    # ------------------------------------------------------------------

    def _process_buildings(self, regions: dict, buildings_queue: list) -> tuple:
        events = []
        remaining = []

        for building in buildings_queue:
            building["ticks_remaining"] = building.get("ticks_remaining", 0) - 1
            if building["ticks_remaining"] <= 0:
                region_id = building["region_id"]
                if region_id in regions:
                    regions[region_id]["building_type"] = building["building_type"]
                    regions[region_id]["defense_bonus"] = building.get("defense_bonus", 0)
                    regions[region_id]["vision_range"] = building.get("vision_range", 0)
                    regions[region_id]["unit_generation_bonus"] = building.get("unit_generation_bonus", 0)
                    events.append({
                        "type": "building_complete",
                        "region_id": region_id,
                        "building_type": building["building_type"],
                        "player_id": building["player_id"],
                    })
            else:
                remaining.append(building)

        return remaining, events

    # ------------------------------------------------------------------
    # Player actions
    # ------------------------------------------------------------------

    def _process_action(self, action: dict, players: dict, regions: dict, buildings_queue: list) -> list:
        action_type = action.get("action_type")
        if action_type == "attack":
            return self._process_attack(action, players, regions)
        elif action_type == "move":
            return self._process_move(action, regions)
        elif action_type == "build":
            return self._process_build(action, regions, buildings_queue)
        return []

    def _process_attack(self, action: dict, players: dict, regions: dict) -> list:
        events = []
        source_id = action.get("source_region_id")
        target_id = action.get("target_region_id")
        units = action.get("units", 0)
        player_id = action.get("player_id")

        source = regions.get(source_id)
        target = regions.get(target_id)
        if not source or not target:
            return events
        if source.get("owner_id") != player_id:
            return events
        if source.get("unit_count", 0) < units:
            return events
        if target_id not in self.neighbor_map.get(source_id, []):
            return events

        source["unit_count"] -= units

        # Combat resolution
        attacker_bonus = float(self.settings.get("attacker_advantage", 0))
        defender_bonus = float(self.settings.get("defender_advantage", 0.1))
        defense_building = target.get("defense_bonus", 0)
        randomness = float(self.settings.get("combat_randomness", 0.2))

        attacker_power = units * (1 + attacker_bonus)
        defender_power = target.get("unit_count", 0) * (1 + defender_bonus + defense_building)

        attacker_roll = attacker_power * (1 + random.uniform(-randomness, randomness))
        defender_roll = defender_power * (1 + random.uniform(-randomness, randomness))

        if attacker_roll > defender_roll:
            surviving = max(1, int(units * (1 - defender_power / max(attacker_power, 1) * 0.5)))
            old_owner = target.get("owner_id")
            target["owner_id"] = player_id
            target["unit_count"] = surviving

            events.append({
                "type": "attack_success",
                "source_region_id": source_id,
                "target_region_id": target_id,
                "player_id": player_id,
                "units": units,
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
            surviving_defenders = max(
                0,
                int(target.get("unit_count", 0) * (1 - attacker_power / max(defender_power, 1) * 0.5)),
            )
            target["unit_count"] = surviving_defenders

            events.append({
                "type": "attack_failed",
                "source_region_id": source_id,
                "target_region_id": target_id,
                "player_id": player_id,
                "units": units,
                "defender_surviving": surviving_defenders,
            })

        return events

    def _process_move(self, action: dict, regions: dict) -> list:
        source_id = action.get("source_region_id")
        target_id = action.get("target_region_id")
        units = action.get("units", 0)
        player_id = action.get("player_id")

        source = regions.get(source_id)
        target = regions.get(target_id)
        if not source or not target:
            return []
        if source.get("owner_id") != player_id or target.get("owner_id") != player_id:
            return []
        if source.get("unit_count", 0) < units:
            return []
        if target_id not in self.neighbor_map.get(source_id, []):
            return []

        source["unit_count"] -= units
        target["unit_count"] = target.get("unit_count", 0) + units

        return [{
            "type": "units_moved",
            "source_region_id": source_id,
            "target_region_id": target_id,
            "units": units,
            "player_id": player_id,
        }]

    def _process_build(self, action: dict, regions: dict, buildings_queue: list) -> list:
        region_id = action.get("region_id")
        building_type = action.get("building_type")
        player_id = action.get("player_id")

        region = regions.get(region_id)
        if not region:
            return []
        if region.get("owner_id") != player_id:
            return []
        # Already has a building
        if region.get("building_type"):
            return []
        # Already building something here
        if any(b["region_id"] == region_id for b in buildings_queue):
            return []

        # Look up building config from settings
        building_configs = self.settings.get("building_types", {})
        config = building_configs.get(building_type, {})
        cost = int(config.get("cost", 30))
        build_time = int(config.get("build_time_ticks", 10))

        if region.get("unit_count", 0) < cost:
            return []

        # Pay cost
        region["unit_count"] -= cost

        buildings_queue.append({
            "region_id": region_id,
            "building_type": building_type,
            "player_id": player_id,
            "ticks_remaining": build_time,
            "total_ticks": build_time,
            "defense_bonus": float(config.get("defense_bonus", 0)),
            "vision_range": int(config.get("vision_range", 0)),
            "unit_generation_bonus": float(config.get("unit_generation_bonus", 0)),
        })

        return [{
            "type": "build_started",
            "region_id": region_id,
            "building_type": building_type,
            "player_id": player_id,
            "ticks_remaining": build_time,
        }]

    # ------------------------------------------------------------------
    # Win/lose conditions
    # ------------------------------------------------------------------

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
        if len(alive) <= 1 and len(players) > 1:
            events.append({
                "type": "game_over",
                "winner_id": alive[0] if alive else None,
            })

        return events
