from django.core.management.base import BaseCommand

from apps.inventory.models import Item, ItemCategory


CATEGORIES = [
    {'name': 'Materiały', 'slug': 'materials', 'order': 1},
    {'name': 'Blueprinty budynków', 'slug': 'blueprints-building', 'order': 2},
    {'name': 'Blueprinty jednostek', 'slug': 'blueprints-unit', 'order': 3},
    {'name': 'Pakiety taktyczne', 'slug': 'tactical-packages', 'order': 4},
    {'name': 'Bonusy', 'slug': 'boosts', 'order': 5},
    {'name': 'Skrzynie', 'slug': 'crates', 'order': 6},
    {'name': 'Klucze', 'slug': 'keys', 'order': 7},
    {'name': 'Kosmetyki', 'slug': 'cosmetics', 'order': 8},
]

ITEMS = [
    # --- Materiały ---
    {'name': 'Złom stalowy', 'slug': 'steel-scrap', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'common', 'icon': 'steel_scrap', 'base_value': 5},
    {'name': 'Płytka obwodu', 'slug': 'circuit-board', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'common', 'icon': 'circuit_board', 'base_value': 5},
    {'name': 'Ogniwo paliwowe', 'slug': 'fuel-cell', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'uncommon', 'icon': 'fuel_cell', 'base_value': 15},
    {'name': 'Proch strzelniczy', 'slug': 'gunpowder', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'uncommon', 'icon': 'gunpowder', 'base_value': 15},
    {'name': 'Protokół dowodzenia', 'slug': 'command-protocol', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'rare', 'icon': 'command_protocol', 'base_value': 40},
    {'name': 'Światłowód', 'slug': 'optic-fiber', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'rare', 'icon': 'optic_fiber', 'base_value': 40},
    {'name': 'Rdzeń plazmowy', 'slug': 'plasma-core', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'epic', 'icon': 'plasma_core', 'base_value': 120},
    {'name': 'Fragment artefaktu', 'slug': 'artifact-fragment', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'legendary', 'icon': 'artifact_fragment', 'base_value': 350},

    # --- Blueprinty budynków (6 budynków × 3 poziomy) ---
    # Koszary
    {'name': 'Blueprint: Koszary Lvl 1', 'slug': 'bp-barracks-1', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'common', 'icon': 'bp_barracks', 'base_value': 20, 'is_consumable': False, 'blueprint_ref': 'barracks', 'level': 1},
    {'name': 'Blueprint: Koszary Lvl 2', 'slug': 'bp-barracks-2', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_barracks', 'base_value': 50, 'is_consumable': False, 'blueprint_ref': 'barracks', 'level': 2},
    {'name': 'Blueprint: Koszary Lvl 3', 'slug': 'bp-barracks-3', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_barracks', 'base_value': 100, 'is_consumable': False, 'blueprint_ref': 'barracks', 'level': 3},
    # Fabryka
    {'name': 'Blueprint: Fabryka Lvl 1', 'slug': 'bp-factory-1', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'common', 'icon': 'bp_factory', 'base_value': 30, 'is_consumable': False, 'blueprint_ref': 'factory', 'level': 1},
    {'name': 'Blueprint: Fabryka Lvl 2', 'slug': 'bp-factory-2', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_factory', 'base_value': 70, 'is_consumable': False, 'blueprint_ref': 'factory', 'level': 2},
    {'name': 'Blueprint: Fabryka Lvl 3', 'slug': 'bp-factory-3', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_factory', 'base_value': 120, 'is_consumable': False, 'blueprint_ref': 'factory', 'level': 3},
    # Wieża obronna
    {'name': 'Blueprint: Wieża Lvl 1', 'slug': 'bp-tower-1', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'common', 'icon': 'bp_tower', 'base_value': 25, 'is_consumable': False, 'blueprint_ref': 'tower', 'level': 1},
    {'name': 'Blueprint: Wieża Lvl 2', 'slug': 'bp-tower-2', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_tower', 'base_value': 60, 'is_consumable': False, 'blueprint_ref': 'tower', 'level': 2},
    {'name': 'Blueprint: Wieża Lvl 3', 'slug': 'bp-tower-3', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_tower', 'base_value': 110, 'is_consumable': False, 'blueprint_ref': 'tower', 'level': 3},
    # Port
    {'name': 'Blueprint: Port Lvl 1', 'slug': 'bp-port-1', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_port', 'base_value': 50, 'is_consumable': False, 'blueprint_ref': 'port', 'level': 1},
    {'name': 'Blueprint: Port Lvl 2', 'slug': 'bp-port-2', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_port', 'base_value': 100, 'is_consumable': False, 'blueprint_ref': 'port', 'level': 2},
    {'name': 'Blueprint: Port Lvl 3', 'slug': 'bp-port-3', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'epic', 'icon': 'bp_port', 'base_value': 180, 'is_consumable': False, 'blueprint_ref': 'port', 'level': 3},
    # Lotnisko
    {'name': 'Blueprint: Lotnisko Lvl 1', 'slug': 'bp-carrier-1', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_carrier', 'base_value': 50, 'is_consumable': False, 'blueprint_ref': 'carrier', 'level': 1},
    {'name': 'Blueprint: Lotnisko Lvl 2', 'slug': 'bp-carrier-2', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_carrier', 'base_value': 100, 'is_consumable': False, 'blueprint_ref': 'carrier', 'level': 2},
    {'name': 'Blueprint: Lotnisko Lvl 3', 'slug': 'bp-carrier-3', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'epic', 'icon': 'bp_carrier', 'base_value': 180, 'is_consumable': False, 'blueprint_ref': 'carrier', 'level': 3},
    # Elektrownia
    {'name': 'Blueprint: Elektrownia Lvl 1', 'slug': 'bp-radar-1', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'common', 'icon': 'bp_radar', 'base_value': 20, 'is_consumable': False, 'blueprint_ref': 'radar', 'level': 1},
    {'name': 'Blueprint: Elektrownia Lvl 2', 'slug': 'bp-radar-2', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_radar', 'base_value': 50, 'is_consumable': False, 'blueprint_ref': 'radar', 'level': 2},
    {'name': 'Blueprint: Elektrownia Lvl 3', 'slug': 'bp-radar-3', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_radar', 'base_value': 100, 'is_consumable': False, 'blueprint_ref': 'radar', 'level': 3},

    # --- Blueprinty jednostek (3 actual units × 3 levels) ---
    # Czołg
    {'name': 'Blueprint: Czołg Lvl 1', 'slug': 'bp-tank-1', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'uncommon', 'icon': 'bp_tank', 'base_value': 40, 'is_consumable': False, 'blueprint_ref': 'tank', 'level': 1},
    {'name': 'Blueprint: Czołg Lvl 2', 'slug': 'bp-tank-2', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'rare', 'icon': 'bp_tank', 'base_value': 90, 'is_consumable': False, 'blueprint_ref': 'tank', 'level': 2},
    {'name': 'Blueprint: Czołg Lvl 3', 'slug': 'bp-tank-3', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'epic', 'icon': 'bp_tank', 'base_value': 180, 'is_consumable': False, 'blueprint_ref': 'tank', 'level': 3},
    # Okręt
    {'name': 'Blueprint: Okręt Lvl 1', 'slug': 'bp-ship-1', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'rare', 'icon': 'bp_ship', 'base_value': 80, 'is_consumable': False, 'blueprint_ref': 'ship', 'level': 1},
    {'name': 'Blueprint: Okręt Lvl 2', 'slug': 'bp-ship-2', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'epic', 'icon': 'bp_ship', 'base_value': 160, 'is_consumable': False, 'blueprint_ref': 'ship', 'level': 2},
    {'name': 'Blueprint: Okręt Lvl 3', 'slug': 'bp-ship-3', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'legendary', 'icon': 'bp_ship', 'base_value': 350, 'is_consumable': False, 'blueprint_ref': 'ship', 'level': 3},
    # Myśliwiec
    {'name': 'Blueprint: Myśliwiec Lvl 1', 'slug': 'bp-fighter-1', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'rare', 'icon': 'bp_fighter', 'base_value': 70, 'is_consumable': False, 'blueprint_ref': 'fighter', 'level': 1},
    {'name': 'Blueprint: Myśliwiec Lvl 2', 'slug': 'bp-fighter-2', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'epic', 'icon': 'bp_fighter', 'base_value': 150, 'is_consumable': False, 'blueprint_ref': 'fighter', 'level': 2},
    {'name': 'Blueprint: Myśliwiec Lvl 3', 'slug': 'bp-fighter-3', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'legendary', 'icon': 'bp_fighter', 'base_value': 300, 'is_consumable': False, 'blueprint_ref': 'fighter', 'level': 3},

    # --- Pakiety taktyczne (5 zdolności × 3 poziomy) ---
    # Tarcza (Shield) — Lvl 1 darmowy, domyślnie w decku
    {'name': 'Pakiet: Tarcza Lvl 1', 'slug': 'pkg-shield-1', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'common', 'icon': 'pkg_shield', 'base_value': 0, 'is_consumable': False, 'blueprint_ref': 'ab_shield', 'level': 1},
    {'name': 'Pakiet: Tarcza Lvl 2', 'slug': 'pkg-shield-2', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'uncommon', 'icon': 'pkg_shield', 'base_value': 50, 'is_consumable': False, 'blueprint_ref': 'ab_shield', 'level': 2},
    {'name': 'Pakiet: Tarcza Lvl 3', 'slug': 'pkg-shield-3', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'rare', 'icon': 'pkg_shield', 'base_value': 120, 'is_consumable': False, 'blueprint_ref': 'ab_shield', 'level': 3},
    # Wirus
    {'name': 'Pakiet: Wirus Lvl 1', 'slug': 'pkg-virus-1', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'uncommon', 'icon': 'pkg_virus', 'base_value': 40, 'is_consumable': False, 'blueprint_ref': 'ab_virus', 'level': 1},
    {'name': 'Pakiet: Wirus Lvl 2', 'slug': 'pkg-virus-2', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'rare', 'icon': 'pkg_virus', 'base_value': 90, 'is_consumable': False, 'blueprint_ref': 'ab_virus', 'level': 2},
    {'name': 'Pakiet: Wirus Lvl 3', 'slug': 'pkg-virus-3', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'epic', 'icon': 'pkg_virus', 'base_value': 180, 'is_consumable': False, 'blueprint_ref': 'ab_virus', 'level': 3},
    # Uderzenie Nuklearne
    {'name': 'Pakiet: Uderzenie Nuklearne Lvl 1', 'slug': 'pkg-nuke-1', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'rare', 'icon': 'pkg_nuke', 'base_value': 100, 'is_consumable': False, 'blueprint_ref': 'ab_province_nuke', 'level': 1},
    {'name': 'Pakiet: Uderzenie Nuklearne Lvl 2', 'slug': 'pkg-nuke-2', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'epic', 'icon': 'pkg_nuke', 'base_value': 250, 'is_consumable': False, 'blueprint_ref': 'ab_province_nuke', 'level': 2},
    {'name': 'Pakiet: Uderzenie Nuklearne Lvl 3', 'slug': 'pkg-nuke-3', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'legendary', 'icon': 'pkg_nuke', 'base_value': 500, 'is_consumable': False, 'blueprint_ref': 'ab_province_nuke', 'level': 3},
    # Wywiad
    {'name': 'Pakiet: Wywiad Lvl 1', 'slug': 'pkg-recon-1', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'common', 'icon': 'pkg_recon', 'base_value': 20, 'is_consumable': False, 'blueprint_ref': 'ab_pr_submarine', 'level': 1},
    {'name': 'Pakiet: Wywiad Lvl 2', 'slug': 'pkg-recon-2', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'uncommon', 'icon': 'pkg_recon', 'base_value': 50, 'is_consumable': False, 'blueprint_ref': 'ab_pr_submarine', 'level': 2},
    {'name': 'Pakiet: Wywiad Lvl 3', 'slug': 'pkg-recon-3', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'rare', 'icon': 'pkg_recon', 'base_value': 110, 'is_consumable': False, 'blueprint_ref': 'ab_pr_submarine', 'level': 3},
    # Pobór
    {'name': 'Pakiet: Pobór Lvl 1', 'slug': 'pkg-conscription-1', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'common', 'icon': 'pkg_conscription', 'base_value': 15, 'is_consumable': False, 'blueprint_ref': 'ab_conscription_point', 'level': 1},
    {'name': 'Pakiet: Pobór Lvl 2', 'slug': 'pkg-conscription-2', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'uncommon', 'icon': 'pkg_conscription', 'base_value': 40, 'is_consumable': False, 'blueprint_ref': 'ab_conscription_point', 'level': 2},
    {'name': 'Pakiet: Pobór Lvl 3', 'slug': 'pkg-conscription-3', 'category_slug': 'tactical-packages', 'item_type': 'tactical_package', 'rarity': 'rare', 'icon': 'pkg_conscription', 'base_value': 100, 'is_consumable': False, 'blueprint_ref': 'ab_conscription_point', 'level': 3},

    # --- Bonusy (4 × 3 poziomy) ---
    # Mobilizacja
    {'name': 'Bonus: Mobilizacja Lvl 1', 'slug': 'boost-mobilization-1', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'common', 'icon': 'boost_mobilization', 'base_value': 15, 'is_consumable': False, 'level': 1,
     'boost_params': {'effect_type': 'unit_bonus', 'value': 0.15}},
    {'name': 'Bonus: Mobilizacja Lvl 2', 'slug': 'boost-mobilization-2', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'uncommon', 'icon': 'boost_mobilization', 'base_value': 35, 'is_consumable': False, 'level': 2,
     'boost_params': {'effect_type': 'unit_bonus', 'value': 0.30}},
    {'name': 'Bonus: Mobilizacja Lvl 3', 'slug': 'boost-mobilization-3', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'rare', 'icon': 'boost_mobilization', 'base_value': 70, 'is_consumable': False, 'level': 3,
     'boost_params': {'effect_type': 'unit_bonus', 'value': 0.50}},
    # Fortyfikacja
    {'name': 'Bonus: Fortyfikacja Lvl 1', 'slug': 'boost-fortification-1', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'common', 'icon': 'boost_fortification', 'base_value': 15, 'is_consumable': False, 'level': 1,
     'boost_params': {'effect_type': 'defense_bonus', 'value': 0.10}},
    {'name': 'Bonus: Fortyfikacja Lvl 2', 'slug': 'boost-fortification-2', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'uncommon', 'icon': 'boost_fortification', 'base_value': 35, 'is_consumable': False, 'level': 2,
     'boost_params': {'effect_type': 'defense_bonus', 'value': 0.20}},
    {'name': 'Bonus: Fortyfikacja Lvl 3', 'slug': 'boost-fortification-3', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'rare', 'icon': 'boost_fortification', 'base_value': 70, 'is_consumable': False, 'level': 3,
     'boost_params': {'effect_type': 'defense_bonus', 'value': 0.35}},
    # Ekonomia Wojenna
    {'name': 'Bonus: Ekonomia Wojenna Lvl 1', 'slug': 'boost-war-economy-1', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'uncommon', 'icon': 'boost_war_economy', 'base_value': 25, 'is_consumable': False, 'level': 1,
     'boost_params': {'effect_type': 'energy_bonus', 'value': 0.20}},
    {'name': 'Bonus: Ekonomia Wojenna Lvl 2', 'slug': 'boost-war-economy-2', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'rare', 'icon': 'boost_war_economy', 'base_value': 60, 'is_consumable': False, 'level': 2,
     'boost_params': {'effect_type': 'energy_bonus', 'value': 0.40}},
    {'name': 'Bonus: Ekonomia Wojenna Lvl 3', 'slug': 'boost-war-economy-3', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'epic', 'icon': 'boost_war_economy', 'base_value': 130, 'is_consumable': False, 'level': 3,
     'boost_params': {'effect_type': 'energy_bonus', 'value': 0.65}},
    # Blitzkrieg
    {'name': 'Bonus: Blitzkrieg Lvl 1', 'slug': 'boost-blitzkrieg-1', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'uncommon', 'icon': 'boost_blitzkrieg', 'base_value': 25, 'is_consumable': False, 'level': 1,
     'boost_params': {'effect_type': 'attack_bonus', 'value': 0.15}},
    {'name': 'Bonus: Blitzkrieg Lvl 2', 'slug': 'boost-blitzkrieg-2', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'rare', 'icon': 'boost_blitzkrieg', 'base_value': 60, 'is_consumable': False, 'level': 2,
     'boost_params': {'effect_type': 'attack_bonus', 'value': 0.30}},
    {'name': 'Bonus: Blitzkrieg Lvl 3', 'slug': 'boost-blitzkrieg-3', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'epic', 'icon': 'boost_blitzkrieg', 'base_value': 130, 'is_consumable': False, 'level': 3,
     'boost_params': {'effect_type': 'attack_bonus', 'value': 0.50}},

    # --- Skrzynie ---
    {'name': 'Skrzynia Żołnierska', 'slug': 'crate-soldier', 'category_slug': 'crates', 'item_type': 'crate', 'rarity': 'common', 'icon': 'crate_soldier', 'base_value': 20, 'is_consumable': True,
     'crate_loot_table': [
         {'item_slug': 'steel-scrap', 'weight': 40, 'min_qty': 2, 'max_qty': 5},
         {'item_slug': 'circuit-board', 'weight': 40, 'min_qty': 2, 'max_qty': 5},
         {'item_slug': 'fuel-cell', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'gunpowder', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'boost-mobilization-1', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-barracks-1', 'weight': 3, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'pkg-shield-1', 'weight': 2, 'min_qty': 1, 'max_qty': 1},
     ]},
    {'name': 'Skrzynia Oficerska', 'slug': 'crate-officer', 'category_slug': 'crates', 'item_type': 'crate', 'rarity': 'uncommon', 'icon': 'crate_officer', 'base_value': 50, 'is_consumable': True,
     'crate_loot_table': [
         {'item_slug': 'fuel-cell', 'weight': 30, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'gunpowder', 'weight': 30, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'command-protocol', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'optic-fiber', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'bp-barracks-1', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-factory-1', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-tower-1', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'boost-fortification-1', 'weight': 4, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'pkg-recon-1', 'weight': 3, 'min_qty': 1, 'max_qty': 1},
     ]},
    {'name': 'Skrzynia Generalna', 'slug': 'crate-general', 'category_slug': 'crates', 'item_type': 'crate', 'rarity': 'rare', 'icon': 'crate_general', 'base_value': 120, 'is_consumable': True,
     'crate_loot_table': [
         {'item_slug': 'command-protocol', 'weight': 25, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'optic-fiber', 'weight': 25, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'plasma-core', 'weight': 15, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-barracks-2', 'weight': 7, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-factory-2', 'weight': 7, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-tank-1', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-ship-1', 'weight': 3, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-fighter-1', 'weight': 3, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'pkg-nuke-1', 'weight': 3, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'boost-war-economy-2', 'weight': 3, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'artifact-fragment', 'weight': 1, 'min_qty': 1, 'max_qty': 1},
     ]},

    # --- Klucze ---
    {'name': 'Klucz Żołnierski', 'slug': 'key-soldier', 'category_slug': 'keys', 'item_type': 'key', 'rarity': 'common', 'icon': 'key_soldier', 'base_value': 15, 'is_consumable': True, 'opens_crate_slug': 'crate-soldier'},
    {'name': 'Klucz Oficerski', 'slug': 'key-officer', 'category_slug': 'keys', 'item_type': 'key', 'rarity': 'uncommon', 'icon': 'key_officer', 'base_value': 35, 'is_consumable': True, 'opens_crate_slug': 'crate-officer'},
    {'name': 'Klucz Generalny', 'slug': 'key-general', 'category_slug': 'keys', 'item_type': 'key', 'rarity': 'rare', 'icon': 'key_general', 'base_value': 80, 'is_consumable': True, 'opens_crate_slug': 'crate-general'},

    # --- Kosmetyki ---
    {'name': 'Kamuflaż Pustynny', 'slug': 'skin-desert-camo', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'uncommon', 'icon': 'skin_desert', 'base_value': 40},
    {'name': 'Biel Arktyczna', 'slug': 'skin-arctic-white', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'uncommon', 'icon': 'skin_arctic', 'base_value': 40},
    {'name': 'Szkarłat Bojowy', 'slug': 'skin-blood-red', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'rare', 'icon': 'skin_blood_red', 'base_value': 80},
    {'name': 'Złoty Dowódca', 'slug': 'skin-golden-commander', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'epic', 'icon': 'skin_golden', 'base_value': 200},
    {'name': 'Emblemat Czaszki', 'slug': 'emblem-skull', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'common', 'icon': 'emblem_skull', 'base_value': 15},
    {'name': 'Emblemat Orła', 'slug': 'emblem-eagle', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'uncommon', 'icon': 'emblem_eagle', 'base_value': 30},
    {'name': 'Emblemat Smoka', 'slug': 'emblem-dragon', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'rare', 'icon': 'emblem_dragon', 'base_value': 60},
    {'name': 'Ślad Ognia', 'slug': 'effect-fire-trail', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'epic', 'icon': 'effect_fire', 'base_value': 180},
    {'name': 'Efekt Błyskawicy', 'slug': 'effect-lightning', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'legendary', 'icon': 'effect_lightning', 'base_value': 500},
]

RECIPES = [
    # -------------------------------------------------------------------------
    # Blueprinty budynków — Koszary (6 receptur: Lvl1, Lvl2 upgrade, Lvl3 upgrade)
    # -------------------------------------------------------------------------
    {'name': 'Stwórz Blueprint Koszary Lvl 1', 'slug': 'craft-bp-barracks-1', 'result_slug': 'bp-barracks-1', 'gold_cost': 10,
     'ingredients': [('steel-scrap', 5), ('gunpowder', 2)]},
    {'name': 'Ulepsz Blueprint Koszary na Lvl 2', 'slug': 'craft-bp-barracks-2', 'result_slug': 'bp-barracks-2', 'gold_cost': 30,
     'ingredients': [('bp-barracks-1', 1), ('steel-scrap', 5), ('gunpowder', 3)]},
    {'name': 'Ulepsz Blueprint Koszary na Lvl 3', 'slug': 'craft-bp-barracks-3', 'result_slug': 'bp-barracks-3', 'gold_cost': 60,
     'ingredients': [('bp-barracks-2', 1), ('steel-scrap', 10), ('command-protocol', 2)]},

    # Fabryka
    {'name': 'Stwórz Blueprint Fabryka Lvl 1', 'slug': 'craft-bp-factory-1', 'result_slug': 'bp-factory-1', 'gold_cost': 15,
     'ingredients': [('steel-scrap', 6), ('fuel-cell', 2)]},
    {'name': 'Ulepsz Blueprint Fabryka na Lvl 2', 'slug': 'craft-bp-factory-2', 'result_slug': 'bp-factory-2', 'gold_cost': 40,
     'ingredients': [('bp-factory-1', 1), ('steel-scrap', 8), ('fuel-cell', 3)]},
    {'name': 'Ulepsz Blueprint Fabryka na Lvl 3', 'slug': 'craft-bp-factory-3', 'result_slug': 'bp-factory-3', 'gold_cost': 80,
     'ingredients': [('bp-factory-2', 1), ('steel-scrap', 12), ('plasma-core', 1)]},

    # Wieża obronna
    {'name': 'Stwórz Blueprint Wieża Lvl 1', 'slug': 'craft-bp-tower-1', 'result_slug': 'bp-tower-1', 'gold_cost': 12,
     'ingredients': [('steel-scrap', 5), ('circuit-board', 2)]},
    {'name': 'Ulepsz Blueprint Wieża na Lvl 2', 'slug': 'craft-bp-tower-2', 'result_slug': 'bp-tower-2', 'gold_cost': 35,
     'ingredients': [('bp-tower-1', 1), ('steel-scrap', 6), ('optic-fiber', 2)]},
    {'name': 'Ulepsz Blueprint Wieża na Lvl 3', 'slug': 'craft-bp-tower-3', 'result_slug': 'bp-tower-3', 'gold_cost': 65,
     'ingredients': [('bp-tower-2', 1), ('steel-scrap', 10), ('command-protocol', 2)]},

    # Port
    {'name': 'Stwórz Blueprint Port Lvl 1', 'slug': 'craft-bp-port-1', 'result_slug': 'bp-port-1', 'gold_cost': 25,
     'ingredients': [('steel-scrap', 8), ('fuel-cell', 3)]},
    {'name': 'Ulepsz Blueprint Port na Lvl 2', 'slug': 'craft-bp-port-2', 'result_slug': 'bp-port-2', 'gold_cost': 55,
     'ingredients': [('bp-port-1', 1), ('steel-scrap', 10), ('optic-fiber', 3)]},
    {'name': 'Ulepsz Blueprint Port na Lvl 3', 'slug': 'craft-bp-port-3', 'result_slug': 'bp-port-3', 'gold_cost': 100,
     'ingredients': [('bp-port-2', 1), ('command-protocol', 3), ('plasma-core', 1)]},

    # Lotnisko
    {'name': 'Stwórz Blueprint Lotnisko Lvl 1', 'slug': 'craft-bp-carrier-1', 'result_slug': 'bp-carrier-1', 'gold_cost': 25,
     'ingredients': [('circuit-board', 6), ('fuel-cell', 3)]},
    {'name': 'Ulepsz Blueprint Lotnisko na Lvl 2', 'slug': 'craft-bp-carrier-2', 'result_slug': 'bp-carrier-2', 'gold_cost': 55,
     'ingredients': [('bp-carrier-1', 1), ('circuit-board', 8), ('optic-fiber', 3)]},
    {'name': 'Ulepsz Blueprint Lotnisko na Lvl 3', 'slug': 'craft-bp-carrier-3', 'result_slug': 'bp-carrier-3', 'gold_cost': 100,
     'ingredients': [('bp-carrier-2', 1), ('command-protocol', 3), ('plasma-core', 1)]},

    # Elektrownia
    {'name': 'Stwórz Blueprint Elektrownia Lvl 1', 'slug': 'craft-bp-radar-1', 'result_slug': 'bp-radar-1', 'gold_cost': 10,
     'ingredients': [('circuit-board', 5), ('optic-fiber', 2)]},
    {'name': 'Ulepsz Blueprint Elektrownia na Lvl 2', 'slug': 'craft-bp-radar-2', 'result_slug': 'bp-radar-2', 'gold_cost': 30,
     'ingredients': [('bp-radar-1', 1), ('circuit-board', 6), ('optic-fiber', 3)]},
    {'name': 'Ulepsz Blueprint Elektrownia na Lvl 3', 'slug': 'craft-bp-radar-3', 'result_slug': 'bp-radar-3', 'gold_cost': 60,
     'ingredients': [('bp-radar-2', 1), ('command-protocol', 2), ('plasma-core', 1)]},

    # -------------------------------------------------------------------------
    # Blueprinty jednostek — Czołg
    # -------------------------------------------------------------------------
    {'name': 'Stwórz Blueprint Czołg Lvl 1', 'slug': 'craft-bp-tank-1', 'result_slug': 'bp-tank-1', 'gold_cost': 20,
     'ingredients': [('steel-scrap', 8), ('fuel-cell', 2)]},
    {'name': 'Ulepsz Blueprint Czołg na Lvl 2', 'slug': 'craft-bp-tank-2', 'result_slug': 'bp-tank-2', 'gold_cost': 50,
     'ingredients': [('bp-tank-1', 1), ('steel-scrap', 12), ('fuel-cell', 4), ('gunpowder', 3)]},
    {'name': 'Ulepsz Blueprint Czołg na Lvl 3', 'slug': 'craft-bp-tank-3', 'result_slug': 'bp-tank-3', 'gold_cost': 100,
     'ingredients': [('bp-tank-2', 1), ('steel-scrap', 18), ('plasma-core', 2), ('command-protocol', 2)]},

    # Blueprinty jednostek — Okręt
    {'name': 'Stwórz Blueprint Okręt Lvl 1', 'slug': 'craft-bp-ship-1', 'result_slug': 'bp-ship-1', 'gold_cost': 40,
     'ingredients': [('steel-scrap', 10), ('optic-fiber', 3), ('fuel-cell', 3)]},
    {'name': 'Ulepsz Blueprint Okręt na Lvl 2', 'slug': 'craft-bp-ship-2', 'result_slug': 'bp-ship-2', 'gold_cost': 90,
     'ingredients': [('bp-ship-1', 1), ('steel-scrap', 15), ('optic-fiber', 5), ('plasma-core', 1)]},
    {'name': 'Ulepsz Blueprint Okręt na Lvl 3', 'slug': 'craft-bp-ship-3', 'result_slug': 'bp-ship-3', 'gold_cost': 180,
     'ingredients': [('bp-ship-2', 1), ('command-protocol', 4), ('plasma-core', 2), ('artifact-fragment', 1)]},

    # Blueprinty jednostek — Myśliwiec
    {'name': 'Stwórz Blueprint Myśliwiec Lvl 1', 'slug': 'craft-bp-fighter-1', 'result_slug': 'bp-fighter-1', 'gold_cost': 35,
     'ingredients': [('circuit-board', 8), ('fuel-cell', 3), ('optic-fiber', 2)]},
    {'name': 'Ulepsz Blueprint Myśliwiec na Lvl 2', 'slug': 'craft-bp-fighter-2', 'result_slug': 'bp-fighter-2', 'gold_cost': 80,
     'ingredients': [('bp-fighter-1', 1), ('circuit-board', 12), ('optic-fiber', 4), ('plasma-core', 1)]},
    {'name': 'Ulepsz Blueprint Myśliwiec na Lvl 3', 'slug': 'craft-bp-fighter-3', 'result_slug': 'bp-fighter-3', 'gold_cost': 160,
     'ingredients': [('bp-fighter-2', 1), ('command-protocol', 4), ('plasma-core', 2), ('artifact-fragment', 1)]},

    # -------------------------------------------------------------------------
    # Pakiety taktyczne — Tarcza
    # -------------------------------------------------------------------------
    {'name': 'Stwórz Pakiet Tarcza Lvl 1', 'slug': 'craft-pkg-shield-1', 'result_slug': 'pkg-shield-1', 'gold_cost': 0,
     'ingredients': [('steel-scrap', 3), ('circuit-board', 2)]},
    {'name': 'Ulepsz Pakiet Tarcza na Lvl 2', 'slug': 'craft-pkg-shield-2', 'result_slug': 'pkg-shield-2', 'gold_cost': 30,
     'ingredients': [('pkg-shield-1', 1), ('steel-scrap', 5), ('optic-fiber', 2)]},
    {'name': 'Ulepsz Pakiet Tarcza na Lvl 3', 'slug': 'craft-pkg-shield-3', 'result_slug': 'pkg-shield-3', 'gold_cost': 70,
     'ingredients': [('pkg-shield-2', 1), ('command-protocol', 3), ('plasma-core', 1)]},

    # Wirus
    {'name': 'Stwórz Pakiet Wirus Lvl 1', 'slug': 'craft-pkg-virus-1', 'result_slug': 'pkg-virus-1', 'gold_cost': 20,
     'ingredients': [('circuit-board', 5), ('command-protocol', 1)]},
    {'name': 'Ulepsz Pakiet Wirus na Lvl 2', 'slug': 'craft-pkg-virus-2', 'result_slug': 'pkg-virus-2', 'gold_cost': 50,
     'ingredients': [('pkg-virus-1', 1), ('circuit-board', 8), ('command-protocol', 2)]},
    {'name': 'Ulepsz Pakiet Wirus na Lvl 3', 'slug': 'craft-pkg-virus-3', 'result_slug': 'pkg-virus-3', 'gold_cost': 110,
     'ingredients': [('pkg-virus-2', 1), ('command-protocol', 4), ('plasma-core', 1)]},

    # Uderzenie Nuklearne
    {'name': 'Stwórz Pakiet Uderzenie Nuklearne Lvl 1', 'slug': 'craft-pkg-nuke-1', 'result_slug': 'pkg-nuke-1', 'gold_cost': 60,
     'ingredients': [('gunpowder', 8), ('plasma-core', 1)]},
    {'name': 'Ulepsz Pakiet Uderzenie Nuklearne na Lvl 2', 'slug': 'craft-pkg-nuke-2', 'result_slug': 'pkg-nuke-2', 'gold_cost': 140,
     'ingredients': [('pkg-nuke-1', 1), ('gunpowder', 12), ('plasma-core', 2)]},
    {'name': 'Ulepsz Pakiet Uderzenie Nuklearne na Lvl 3', 'slug': 'craft-pkg-nuke-3', 'result_slug': 'pkg-nuke-3', 'gold_cost': 300,
     'ingredients': [('pkg-nuke-2', 1), ('plasma-core', 3), ('artifact-fragment', 1)]},

    # Wywiad
    {'name': 'Stwórz Pakiet Wywiad Lvl 1', 'slug': 'craft-pkg-recon-1', 'result_slug': 'pkg-recon-1', 'gold_cost': 10,
     'ingredients': [('steel-scrap', 4), ('optic-fiber', 2)]},
    {'name': 'Ulepsz Pakiet Wywiad na Lvl 2', 'slug': 'craft-pkg-recon-2', 'result_slug': 'pkg-recon-2', 'gold_cost': 30,
     'ingredients': [('pkg-recon-1', 1), ('optic-fiber', 3), ('fuel-cell', 2)]},
    {'name': 'Ulepsz Pakiet Wywiad na Lvl 3', 'slug': 'craft-pkg-recon-3', 'result_slug': 'pkg-recon-3', 'gold_cost': 65,
     'ingredients': [('pkg-recon-2', 1), ('optic-fiber', 5), ('command-protocol', 2)]},

    # Pobór
    {'name': 'Stwórz Pakiet Pobór Lvl 1', 'slug': 'craft-pkg-conscription-1', 'result_slug': 'pkg-conscription-1', 'gold_cost': 8,
     'ingredients': [('gunpowder', 4), ('steel-scrap', 3)]},
    {'name': 'Ulepsz Pakiet Pobór na Lvl 2', 'slug': 'craft-pkg-conscription-2', 'result_slug': 'pkg-conscription-2', 'gold_cost': 25,
     'ingredients': [('pkg-conscription-1', 1), ('gunpowder', 5), ('command-protocol', 1)]},
    {'name': 'Ulepsz Pakiet Pobór na Lvl 3', 'slug': 'craft-pkg-conscription-3', 'result_slug': 'pkg-conscription-3', 'gold_cost': 60,
     'ingredients': [('pkg-conscription-2', 1), ('gunpowder', 8), ('command-protocol', 3)]},

    # -------------------------------------------------------------------------
    # Bonusy — Mobilizacja
    # -------------------------------------------------------------------------
    {'name': 'Stwórz Bonus Mobilizacja Lvl 1', 'slug': 'craft-boost-mobilization-1', 'result_slug': 'boost-mobilization-1', 'gold_cost': 8,
     'ingredients': [('steel-scrap', 3), ('fuel-cell', 1)]},
    {'name': 'Ulepsz Bonus Mobilizacja na Lvl 2', 'slug': 'craft-boost-mobilization-2', 'result_slug': 'boost-mobilization-2', 'gold_cost': 20,
     'ingredients': [('boost-mobilization-1', 1), ('steel-scrap', 5), ('fuel-cell', 2)]},
    {'name': 'Ulepsz Bonus Mobilizacja na Lvl 3', 'slug': 'craft-boost-mobilization-3', 'result_slug': 'boost-mobilization-3', 'gold_cost': 45,
     'ingredients': [('boost-mobilization-2', 1), ('fuel-cell', 4), ('command-protocol', 1)]},

    # Fortyfikacja
    {'name': 'Stwórz Bonus Fortyfikacja Lvl 1', 'slug': 'craft-boost-fortification-1', 'result_slug': 'boost-fortification-1', 'gold_cost': 8,
     'ingredients': [('steel-scrap', 4), ('gunpowder', 1)]},
    {'name': 'Ulepsz Bonus Fortyfikacja na Lvl 2', 'slug': 'craft-boost-fortification-2', 'result_slug': 'boost-fortification-2', 'gold_cost': 20,
     'ingredients': [('boost-fortification-1', 1), ('steel-scrap', 6), ('gunpowder', 2)]},
    {'name': 'Ulepsz Bonus Fortyfikacja na Lvl 3', 'slug': 'craft-boost-fortification-3', 'result_slug': 'boost-fortification-3', 'gold_cost': 45,
     'ingredients': [('boost-fortification-2', 1), ('gunpowder', 4), ('command-protocol', 1)]},

    # Ekonomia Wojenna
    {'name': 'Stwórz Bonus Ekonomia Wojenna Lvl 1', 'slug': 'craft-boost-war-economy-1', 'result_slug': 'boost-war-economy-1', 'gold_cost': 14,
     'ingredients': [('circuit-board', 4), ('fuel-cell', 2)]},
    {'name': 'Ulepsz Bonus Ekonomia Wojenna na Lvl 2', 'slug': 'craft-boost-war-economy-2', 'result_slug': 'boost-war-economy-2', 'gold_cost': 35,
     'ingredients': [('boost-war-economy-1', 1), ('circuit-board', 5), ('fuel-cell', 3)]},
    {'name': 'Ulepsz Bonus Ekonomia Wojenna na Lvl 3', 'slug': 'craft-boost-war-economy-3', 'result_slug': 'boost-war-economy-3', 'gold_cost': 80,
     'ingredients': [('boost-war-economy-2', 1), ('optic-fiber', 4), ('plasma-core', 1)]},

    # Blitzkrieg
    {'name': 'Stwórz Bonus Blitzkrieg Lvl 1', 'slug': 'craft-boost-blitzkrieg-1', 'result_slug': 'boost-blitzkrieg-1', 'gold_cost': 14,
     'ingredients': [('gunpowder', 4), ('fuel-cell', 2)]},
    {'name': 'Ulepsz Bonus Blitzkrieg na Lvl 2', 'slug': 'craft-boost-blitzkrieg-2', 'result_slug': 'boost-blitzkrieg-2', 'gold_cost': 35,
     'ingredients': [('boost-blitzkrieg-1', 1), ('gunpowder', 5), ('fuel-cell', 3)]},
    {'name': 'Ulepsz Bonus Blitzkrieg na Lvl 3', 'slug': 'craft-boost-blitzkrieg-3', 'result_slug': 'boost-blitzkrieg-3', 'gold_cost': 80,
     'ingredients': [('boost-blitzkrieg-2', 1), ('gunpowder', 8), ('plasma-core', 1)]},

    # -------------------------------------------------------------------------
    # Kosmetyki
    # -------------------------------------------------------------------------
    {'name': 'Stwórz Kamuflaż Pustynny', 'slug': 'craft-skin-desert', 'result_slug': 'skin-desert-camo', 'gold_cost': 20,
     'ingredients': [('steel-scrap', 5), ('fuel-cell', 2)]},
    {'name': 'Stwórz Szkarłat Bojowy', 'slug': 'craft-skin-blood-red', 'result_slug': 'skin-blood-red', 'gold_cost': 50,
     'ingredients': [('plasma-core', 1), ('gunpowder', 5)]},
    {'name': 'Stwórz Złoty Dowódca', 'slug': 'craft-skin-golden', 'result_slug': 'skin-golden-commander', 'gold_cost': 150,
     'ingredients': [('plasma-core', 2), ('artifact-fragment', 1), ('command-protocol', 3)]},
]


class Command(BaseCommand):
    help = "Seed economy data: item categories, items, and crafting recipes"

    def handle(self, *args, **options):
        from apps.crafting.models import Recipe, RecipeIngredient

        # Categories
        cat_map = {}
        for cat_data in CATEGORIES:
            obj, created = ItemCategory.objects.update_or_create(
                slug=cat_data['slug'],
                defaults={'name': cat_data['name'], 'order': cat_data['order']},
            )
            cat_map[cat_data['slug']] = obj
            status = "created" if created else "updated"
            self.stdout.write(f"  ItemCategory {obj.name}: {status}")

        # Items (first pass: all except key->crate FK)
        item_map = {}
        crate_links = {}  # key_slug -> crate_slug

        for item_data in ITEMS:
            cat_slug = item_data.get('category_slug')
            opens_crate_slug = item_data.get('opens_crate_slug')

            defaults = {
                'name': item_data['name'],
                'category': cat_map[cat_slug],
                'item_type': item_data['item_type'],
                'rarity': item_data['rarity'],
                'icon': item_data.get('icon', ''),
                'base_value': item_data.get('base_value', 0),
                'is_consumable': item_data.get('is_consumable', False),
                'is_tradeable': item_data.get('is_tradeable', True),
                'blueprint_ref': item_data.get('blueprint_ref', ''),
                'level': item_data.get('level', 1),
            }
            if 'crate_loot_table' in item_data:
                defaults['crate_loot_table'] = item_data['crate_loot_table']
            if 'boost_params' in item_data:
                defaults['boost_params'] = item_data['boost_params']

            obj, created = Item.objects.update_or_create(
                slug=item_data['slug'],
                defaults=defaults,
            )
            item_map[item_data['slug']] = obj
            status = "created" if created else "updated"
            self.stdout.write(f"  Item {obj.name}: {status}")

            if opens_crate_slug:
                crate_links[item_data['slug']] = opens_crate_slug

        # Second pass: link keys to crates
        for key_slug, crate_slug in crate_links.items():
            key_item = item_map.get(key_slug)
            crate_item = item_map.get(crate_slug)
            if key_item and crate_item:
                key_item.opens_crate = crate_item
                key_item.save(update_fields=['opens_crate'])
                self.stdout.write(f"  Linked {key_slug} -> {crate_slug}")

        # Recipes
        for idx, recipe_data in enumerate(RECIPES):
            result_item = item_map.get(recipe_data['result_slug'])
            if not result_item:
                self.stdout.write(self.style.WARNING(f"  Skipping recipe {recipe_data['slug']}: result item not found"))
                continue

            recipe, created = Recipe.objects.update_or_create(
                slug=recipe_data['slug'],
                defaults={
                    'name': recipe_data['name'],
                    'result_item': result_item,
                    'result_quantity': 1,
                    'gold_cost': recipe_data['gold_cost'],
                    'order': idx,
                },
            )

            RecipeIngredient.objects.filter(recipe=recipe).delete()
            for ing_slug, ing_qty in recipe_data['ingredients']:
                ing_item = item_map.get(ing_slug)
                if ing_item:
                    RecipeIngredient.objects.create(
                        recipe=recipe,
                        item=ing_item,
                        quantity=ing_qty,
                    )

            status = "created" if created else "updated"
            self.stdout.write(f"  Recipe {recipe.name}: {status}")

        self.stdout.write(self.style.SUCCESS("Economy seed complete!"))
