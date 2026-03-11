extends Node
class_name BadgesList


const default_path = "res://assets/items/default_item.webp"


const assets = {
	
	'AIR_FORCE_1': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_2': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_3': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_4': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_5': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_6': "res://assets/badges/badge_builder_h300.webp",
	'AIR_FORCE_7': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_8': "res://assets/badges/badge_air_force_h300.webp",
	'AIR_FORCE_9': "res://assets/badges/badge_air_force_h300.webp",
	'VICTORY_1': "res://assets/badges/badge_victory_h300.webp",
	'VICTORY_2': "res://assets/badges/badge_victory_h300.webp",
	'VICTORY_3':"res://assets/badges/badge_victory_h300.webp" ,
	'COMMEMORATION_1': "res://assets/badges/badge_commemoration_h300.webp",
	'COMMEMORATION_2': "res://assets/badges/badge_commemoration_h300.webp",
	'COMMEMORATION_3': "res://assets/badges/badge_commemoration_h300.webp",
	'COMMEMORATION_4': "res://assets/badges/badge_commemoration_h300.webp",
	'COMMEMORATION_5': "res://assets/badges/badge_commemoration_h300.webp",
	'COMMEMORATION_6': "res://assets/badges/badge_commemoration_h300.webp",
	'BUILDER_1': "res://assets/badges/badge_builder_h300.webp",
	'BUILDER_2': "res://assets/badges/badge_builder_h300.webp",
	'BUILDER_3': "res://assets/badges/badge_builder_h300.webp",
	'BUILDER_4': "res://assets/badges/badge_builder_h300.webp",
	'BUILDER_5': "res://assets/badges/badge_builder_h300.webp",
	'BUILDER_6': "res://assets/badges/badge_builder_h300.webp",
	'CAPITAN_OF_THE_SEAS_1': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_2': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_3': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_4': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_5': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_6': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_7': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_8': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'CAPITAN_OF_THE_SEAS_9': "res://assets/badges/badge_capitab_of_the_seas_h300.webp",
	'ABILITY': "res://assets/badges/badge_ability_h300.webp",
	'CONQUEROR_1': "res://assets/badges/badge_conqueror_h300.webp",
	'CONQUEROR_2': "res://assets/badges/badge_conqueror_h300.webp",
	'CONQUEROR_3': "res://assets/badges/badge_conqueror_h300.webp",
	'CONQUEROR_4': "res://assets/badges/badge_conqueror_h300.webp",
	'CONQUEROR_5': "res://assets/badges/badge_conqueror_h300.webp",
	'DEFENDING_THE_SKIES_1': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_2': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_3': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_4': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_5': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_6': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_7': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_8': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'DEFENDING_THE_SKIES_9': "res://assets/badges/badge_defending_of_skies_h300.webp",
	'WORLD_CONQUEST': "res://assets/badges/badge_world_conquest_h300.webp",
	'COLLECTORS': "res://assets/badges/badge_collector_h300.webp",
	'TREASURES_1': "res://assets/badges/badge_tresasures_h300.webp",
	'TREASURES_2': "res://assets/badges/badge_tresasures_h300.webp",
	'TREASURES_3': "res://assets/badges/badge_tresasures_h300.webp",
	'TREASURES_4': "res://assets/badges/badge_tresasures_h300.webp",
	'TREASURES_5': "res://assets/badges/badge_tresasures_h300.webp",
	'GRAND_TREASURES_1': "res://assets/badges/badge_grand_tresasures_h300.webp",
	'GRAND_TREASURES_2': "res://assets/badges/badge_grand_tresasures_h300.webp",
	'GRAND_TREASURES_3': "res://assets/badges/badge_grand_tresasures_h300.webp",
	'GRAND_TREASURES_4': "res://assets/badges/badge_grand_tresasures_h300.webp",
	'GRAND_TREASURES_5': "res://assets/badges/badge_grand_tresasures_h300.webp",
	'MAPLORD_1': "res://assets/badges/badge_maplord_1_h300.webp",
	'MAPLORD_2': "res://assets/badges/badge_maplord_2_h300.webp",
	'MAPLORD_3': "res://assets/badges/badge_maplord_3_h300.webp",
	'ZONE_MODE_VETERAN_1': "res://assets/badges/badge_mode_zone_veteran_h300.webp" ,
	'ZONE_MODE_VETERAN_2': "res://assets/badges/badge_mode_zone_veteran_h300.webp",
	'ZONE_MODE_VETERAN_3': "res://assets/badges/badge_mode_zone_veteran_h300.webp",
	'LONG_MODE_VETERAN': "res://assets/badges/badge_long_mode_veteran_h300.webp",
	'QUICK_MODE_VETERAN': "res://assets/badges/badge_quick_zone_veteran_h300.webp",
	'LEVEL': "res://assets/badges/badge_level_h300.webp",
	'TEAM_PLAY': "res://assets/badges/badge_teamplay_mode_veteran_h300.webp",
	'EXCHANGE': "res://assets/badges/badge_exchange_h300.webp",
	'DONOR': "res://assets/badges/badge_donor_h300.webp",
	
	"DICTATOR": "res://assets/badges/badge_dictator_h300.webp",
	"MAPLORD": "res://assets/badges/badge_maplord_h300.webp",
	
	"EVENT_1": "res://assets/badges/badge_event_1_h300.png"
}


static func get_asset_texture_path_by_name(name : String):
	if assets.has(name):
		return assets[name]
	else:
		return default_path
