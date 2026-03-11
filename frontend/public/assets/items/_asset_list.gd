extends Node
class_name ItemsList


const default_path = "res://assets/items/default_item.webp"


const assets = {
	
	## common
	"FUEL": "res://assets/items/v4/fuel_h300.webp",
	"CLOTH": "res://assets/items/v4/cloth_h300.webp",
	"VITAMINS": "res://assets/items/v4/vitamins_h300.webp",
	"WOOD": "res://assets/items/v4/wood_h300.webp",
	'IRON_ORE': "res://assets/items/v2/iron_oreml1_h300.webp",
	'IRON_INGOT': "res://assets/items/v2/iron_ingotml_h300.webp",
	'ALUMINUM_ORE': "res://assets/items/v2/auluminum_oreml_h300.webp",
	'ALUMINIUM_INGOT': "res://assets/items/v2/aluminum_ingotml2_h300.webp",
	'COAL': "res://assets/items/v2/coalml_h300.webp",
	'PAPER': "res://assets/items/v3/paper_h300.webp",
	'WATER': "res://assets/items/v3/water_h300.webp",
	
	## uncommon
	'COPPER_ORE': "res://assets/items/v2/cooperml_h300.webp",
	'COPPER_INGOT': "res://assets/items/v2/cooper_ingotml2_h300.webp",
	"METAL_SCRAPS": "res://assets/items/v3/scraps_h300.webp",
	"DYNAMITE": "res://assets/items/v4/granade_h300.webp",
	"DRUGS": "res://assets/items/v3/first_aid_h300.webp",
	"GUNS": "res://assets/items/v3/guns_h300.webp",
	"BATTERY": "res://assets/items/v3/cells_h300.webp",
	
	## rare
	'SILVER_ORE': "res://assets/items/v2/silver_oreml_h300.webp",
	'SILVER_INGOT': "res://assets/items/v2/silver_ingotml_h300.webp",
	"BOOK": "res://assets/items/v4/book_h300.webp",
	"SOLAR_PANEL": "res://assets/items/v4/solar_h300.webp",
	'PARACHUTE': "res://assets/items/v3/parasuite_h300.webp",
	'RADIO': "res://assets/items/v3/radio_h300.webp",
	
	## smuggled
	'GOLD_ORE': "res://assets/items/v2/gold_oreml_h300.webp",
	'GOLD_INGOT': "res://assets/items/v2/gold_ingotml_h300.webp",
	"MICROPROCESSOR": "res://assets/items/v4/cpu_h300.webp",
	"ENGINE": "res://assets/items/v4/engine_h300.webp",
	"LASER": "res://assets/items/v4/laser_h300.webp",
	'URANIUM': "res://assets/items/v2/uraniumml_h300.webp",
	'FLOPPY_DISK': "res://assets/items/v3/floppy_disk_h300.webp",
	'MAP': "res://assets/items/v3/map_h300.webp",
	'ABILITY_BOOST': "res://assets/items/v3/ability_boost.webp",
	'MARKETPLACE_PASS': "res://assets/items/v4/marketplace_pass_h300.png",
	
	## top secret
	"HIGH_TECH_PLAN": "res://assets/items/v4/higt_tech_plan_h300.webp",
	"EBOLA_VIRUS": "res://assets/items/v3/ebola_virus_h300.webp",
	"MAGNETIC_CORE": "res://assets/items/v4/magnetic_core_h300.webp",
	"BIOLOGICAL_HAZARD": "res://assets/items/v3/radioactive_h300.webp",
	'DIAMOND': "res://assets/items/v2/diamondml1_h300.webp",
	'EMERALD': "res://assets/items/v2/emeraldml1_h300.webp",
	'COBALT': "res://assets/items/v2/cobalt_ml3_h300.webp",
	'SECRET_DATA': "res://assets/items/v4/secret_data_h300.webp",
	'ROCKET_ENGINES': "res://assets/items/v3/rocket_engines_h300.webp",
	"ABILITY_SCHEMATIC": "res://assets/items/v3/schematic.webp",
	
	## legendary
	'JADEITE': "res://assets/items/v2/jadeite_h300.webp",
	'SAPPHIRE': "res://assets/items/v2/saphireml2_h300.webp",
	'RUBY': "res://assets/items/v2/rubyml_h300.webp",
	'LITHIUM': "res://assets/items/v2/lithiumml_h300.webp",
	'REE': "res://assets/items/v2/reeml_h300.webp",
	'ANCIENT_ARTIFACTS': "res://assets/items/v2/ancient_artefacts_h300.webp",
	'GENERAL_TRAINING': "res://assets/items/v3/general_training.webp",
	'SPECIALIZATION_CARD': "res://assets/items/v4/specialization_card_h300.webp",
	'HI_UPGRADE_PROTECTION': "res://assets/items/v4/hi_upgrade_protection_h300.png",
	'HI_UPGRADE_CHANCE_GAIN': "res://assets/items/v4/hi_chance_gain_h300.webp",
	'HI_UPGRADE_CHANCE_GAIN_PLUS': "res://assets/items/v4/hi_chance_gain_plus_h300.webp",
	'HI_SKIP_ITEM': "res://assets/items/v4/hi_skipper_h300.webp",
	'KEY_CHEST': "res://assets/items/v4/chest_key_h300.webp",
	'MAPLORD_PASS': "res://assets/items/v4/secret_item_h300.webp",
	'DICTATOR_PASS': "res://assets/items/v4/secret_item_h300.webp",
	'DICTATORS_SOUVENIR': "res://assets/items/v4/general_picture_h300.webp",
	"DYNAMITE_MINE": "res://assets/items/v4/dynamite_h300.webp",
	
	## legendary - held items
	'EARNINGS_MEDAL': "res://assets/items/held_items/medal_zarobkut_h300.webp",
	'FORCE_FIELD': "res://assets/items/held_items/force_fieldt_h300.webp",
	'TELEPORTATION': "res://assets/items/held_items/teleportacjat_h300.webp",
	'DICTATORS_SCEPTER': "res://assets/items/held_items/berlo_dyktatorat_h300.webp",
	'SWORD_OF_THE_GENERAL': "res://assets/items/held_items/miecz_generalat_h300.webp",
	'GENERALS_REVOLVER': "res://assets/items/held_items/rewolwer_generalat_h300.webp",
	'TACTICAL_PLAN': "res://assets/items/held_items/plan_taktycznyt_h300.webp",
	'NEW_LEADER_THOUGHT_BOOK': "res://assets/items/held_items/ksiazeczka_mysli_nowego_lidera_h300.webp",
	'TACTICAL_MAP': "res://assets/items/held_items/mapa_taktycznat_h300.webp",
	'CAPTAINS_TELESCOPE': "res://assets/items/held_items/luneta_kapitanat_h300.webp",
	'ALLIANCE_WITH_REBELS': "res://assets/items/held_items/sojusz_z_buntownikamit1_h300.webp",
	'ENGINEERS_DIPLOMA': "res://assets/items/held_items/dyplom_inzynierat_h300.webp",
	'FAST_APPOINTMENT_LICENSE': "res://assets/items/held_items/licencja_na_szybkie_powolaniet1_h300.webp",
	'WHITE_FLAG': "res://assets/items/held_items/biala_flaga_h300.webp",
	'DIAMOND_PICK': "res://assets/items/held_items/diamentowy_kiloft_h300.webp",
	'PRODUCTION_LINE': "res://assets/items/held_items/linie_produkcyjnet_h300.webp",
	'DICTATORS_WHIP': "res://assets/items/held_items/bat_dyktatorat_h300.webp",
	'LICENSE_OF_GOOD_ORGANIZATION': "res://assets/items/held_items/licencja_dobrej_organizacjit_h300.webp",
	
	## unofficial
	'RED_BERYL': "res://assets/items/v2/red_berylml_h300.webp",
	'TANZANITE': "res://assets/items/v2/tanzaniteml_h300.webp",
	'PINK_DIAMOND': "res://assets/items/v2/pink_diamondml_h300.webp",
	'OPAL': "res://assets/items/v2/opalml_h300.webp",
	'BLACK_OPAL': "res://assets/items/v2/black_opalml_h300.webp",
	'TAAFFEITE': "res://assets/items/v2/taaffeiteml_h300.webp",
	'PAINITE': "res://assets/items/v2/painiteml2_h300.webp",
	'BENITOITE': "res://assets/items/v2/benitoiteml_h300.webp",
	'ABILITY_SKIP_ITEM': "res://assets/items/v3/ability_skip_item.webp",
	'ABILITY_LVL_MAX': "res://assets/items/v3/ability_lvl_max.webp",

	## match items
	"SMALL_TRANSPORTER": "res://assets/items/v3/small_transporter_h300_sq.webp",
	"MEDIUM_TRANSPORTER": "res://assets/items/v3/medium_transporter_h300_sq.webp",
	"GIANT_TRANSPORTER": "res://assets/items/v3/giant_transporter_h300_sq.webp",
	"BOMBER": "res://assets/items/v3/bomber_h300_sq.webp",

	"BOAT": "res://assets/items/v3/ship1_h300.webp",
	"SHIP": "res://assets/items/v3/ship2_h300.webp",
	"GIANT_SHIP": "res://assets/items/v3/ship3_h300.webp",
	
	'MISSILE_1': "res://assets/items/v3/missile1.webp",
	'MISSILE_2': "res://assets/items/v3/missile2.webp",
	'MISSILE_3': "res://assets/items/v3/missile3.webp",
	
	## chests
	"CHEST_WOODEN": "res://assets/items/chests/chest_wooden.webp",
	"CHEST_WOODEN_IRON": "res://assets/items/chests/chest_wooden_iron.webp",
	"CHEST_IRON": "res://assets/items/chests/chest_iron.webp",
	"CHEST_MIDSEA": "res://assets/items/chests/chest_midsea.webp",
	"CHEST_DICTATOR": "res://assets/items/chests/chest_dictator.webp",
	"CHEST_GOLD": "res://assets/items/chests/chest_gold.webp",
	"CHEST_MAPLORD": "res://assets/items/chests/chest_maplord.webp",
	"CHEST_CODED": "res://assets/items/chests/chest_coded.webp",
	"CHEST_SECRET": "res://assets/items/chests/chest_secret.webp",
	"CHEST_TITAN": "res://assets/items/chests/chest_titan.webp",
	
	# old
#
#	"B2_BOMBER": "res://assets/items/b2_bomber_h300.png",
	
}


static func get_asset_texture_path_by_name(name : String):
	if assets.has(name):
		return assets[name]
	else:
		return default_path
