extends Node
class_name AbilitiesList


const assets = {
	"TROOP_SPEED_UP": "res://assets/abilities/ab_speed.webp",
	"TROOP_PATH_CREATOR": "res://assets/abilities/ab_path_create.webp",
	"TROOP_ROCKETS": "res://assets/abilities/ab_rockets.webp",
	"TROOP_DESANT": "res://assets/abilities/ab_desant.webp",
	"TROOP_DESERTION": "res://assets/abilities/ab_desertion.webp",
	"TROOP_HEAVY_MACHINES": "res://assets/abilities/ab_robot_dog_troop.webp",
	"TROOP_SLOWDOWN": "res://assets/abilities/ab_freeze.webp",
	"TROOP_NINJA" : "res://assets/abilities/ab_ninja.webp",
	
	"PROVINCE_NUKE": "res://assets/abilities/ab_province_nuke.webp",
	"PROVINCE_QUICK_GAIN": "res://assets/abilities/ab_fast_gain.webp",
	"PROVINCE_HOLO": "res://assets/abilities/ab_holo.webp",
	"PROVINCE_EPM": "res://assets/abilities/ab_impuls.webp",
	"PROVINCE_VIRUS": "res://assets/abilities/ab_virus.webp",
	"PROVINCE_FOG_OF_WAR": "res://assets/abilities/ab_smoke.webp",
	"PROVINCE_EVACUATION": "res://assets/abilities/ab_evacuation.webp",
	"PROVINCE_CONSCRIPTION_POINT": "res://assets/abilities/ab_conscription_point.webp",
	"PROVINCE_CIVILIAN_TRAINING": "res://assets/abilities/ab_cyvilian_training.webp",
	"PROVINCE_SHIELD": "res://assets/abilities/ab_shield.webp",
	"PROVINCE_TRAP": "res://assets/abilities/ab_trap.webp",
	"PROVINCE_PROTECTED_TRAIL": "res://assets/abilities/ab_pr_tall_grass.webp",
	"PROVINCE_WEAK_SPOT": "res://assets/abilities/ab_weak_spot.webp",
	"PROVINCE_RECONNAISSANCE_SUBMARINE": "res://assets/abilities/ab_pr_submarine.webp",
	"PROVINCE_RADAR": "res://assets/abilities/ab_pr_radar.webp",
	"PROVINCE_HYPNOSIS": "res://assets/abilities/ab_hipnosis.webp",
	"PROVINCE_CEASEFIRE": "res://assets/abilities/ab_cooperation.webp",
	"PROVINCE_SHELTER": "res://assets/abilities/ab_shelter.webp",
	"PROVINCE_WALL": "res://assets/abilities/ab_wall.webp",
	"PROVINCE_NINJA" : "res://assets/items/default_item.webp",
} 

const assets_nm = {
	"TROOP_SPEED_UP": "res://assets/abilities/ab_speed_nm.webp",
	"TROOP_PATH_CREATOR": "res://assets/abilities/ab_path_create_nm.webp",
	"TROOP_ROCKETS": "res://assets/abilities/ab_rockets_nm.webp",
	"TROOP_DESANT": "res://assets/abilities/ab_desant_nm.webp",
	"TROOP_DESERTION": "res://assets/abilities/ab_desertion_nm.webp",
	"TROOP_HEAVY_MACHINES": "res://assets/abilities/ab_robot_dog_troop_nm.webp",
	"TROOP_SLOWDOWN": "res://assets/abilities/ab_freeze_nm.webp",
	"TROOP_NINJA" : "res://assets/abilities/ab_ninja_nm.webp",
	
	"PROVINCE_NUKE": "res://assets/abilities/ab_province_nuke_nm.webp",
	"PROVINCE_QUICK_GAIN": "res://assets/abilities/ab_fast_gain_nm.webp",
	"PROVINCE_HOLO": "res://assets/abilities/ab_holo_nm.webp",
	"PROVINCE_EPM": "res://assets/abilities/ab_impuls_nm.webp",
	"PROVINCE_VIRUS": "res://assets/abilities/ab_virus_nm.webp",
	"PROVINCE_FOG_OF_WAR": "res://assets/abilities/ab_smoke_nm.webp",
	"PROVINCE_EVACUATION": "res://assets/abilities/ab_evacuation_nm.webp",
	"PROVINCE_CONSCRIPTION_POINT": "res://assets/abilities/ab_conscription_point_nm.webp",
	"PROVINCE_CIVILIAN_TRAINING": "res://assets/abilities/ab_cyvilian_training_nm.webp",
	"PROVINCE_SHIELD": "res://assets/abilities/ab_shield_nm.webp",
	"PROVINCE_TRAP": "res://assets/abilities/ab_trap_nm.webp",
	"PROVINCE_PROTECTED_TRAIL": "res://assets/abilities/ab_pr_tall_grass_nm.webp",
	"PROVINCE_WEAK_SPOT": "res://assets/abilities/ab_weak_spot_nm.webp",
	"PROVINCE_RECONNAISSANCE_SUBMARINE": "res://assets/abilities/ab_pr_submarine_nm.webp",
	"PROVINCE_RADAR": "res://assets/abilities/ab_pr_radar_nm.webp",
	"PROVINCE_HYPNOSIS": "res://assets/abilities/ab_hipnosis_nm.webp",
	"PROVINCE_CEASEFIRE": "res://assets/abilities/ab_cooperation_nm.webp",
	"PROVINCE_SHELTER": "res://assets/abilities/ab_shelter_nm.webp",
	"PROVINCE_WALL": "res://assets/abilities/ab_wall_nm.webp",
} 

static func get_asset_texture_path_by_name(name : String):
	if assets.has(name):
		return assets[name]

static func get_asset_nm_texture_path_by_name(name : String):
	if assets_nm.has(name):
		return assets_nm[name]
