extends Node
class_name IconsList


const default_path = "res://assets/icons/capital_conqured.webp"

const assets = {
	"capital_conqured": "res://assets/icons/capital_conqured.webp",
	
}

static func get_asset_texture_path_by_name(name : String):
	if assets.has(name):
		return assets[name]
	else:
		return default_path
