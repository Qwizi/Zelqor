extends Node
class_name ClanLogoList


static var assets = {
	"swords": {
		"texture": "res://assets/clan_logo/logo/herby_#g19085.webp"
	},
	"tree": {
		"texture": "res://assets/clan_logo/logo/herby_#image10025-7.webp"
	},
	"knight": {
		"texture": "res://assets/clan_logo/logo/herby_#image10037-9.webp"
	},
	"sun": {
		"texture": "res://assets/clan_logo/logo/herby_#image10049-0.webp"
	},
	"snakes": {
		"texture": "res://assets/clan_logo/logo/herby_#image10061-2.webp"
	},
	"warsaw": {
		"texture": "res://assets/clan_logo/logo/herby_#image10073-3.webp"
	},
	"scale": {
		"texture": "res://assets/clan_logo/logo/herby_#image10085-9.webp"
	},
	"death": {
		"texture": "res://assets/clan_logo/logo/herby_#image10097-9.webp"
	},
	"lion": {
		"texture": "res://assets/clan_logo/logo/herby_#image10121-0.webp"
	},
	"boar": {
		"texture": "res://assets/clan_logo/logo/herby_#image10133-3.webp"
	},
	"trident": {
		"texture": "res://assets/clan_logo/logo/herby_#image10145-9.webp"
	},
	"bear_foot": {
		"texture": "res://assets/clan_logo/logo/herby_#image10157-8.webp"
	},
	"f16": {
		"texture": "res://assets/clan_logo/logo/herby_#image10169-6.webp"
	},
	"wolf": {
		"texture": "res://assets/clan_logo/logo/herby_#image10181-5.webp"
	},
	"bird": {
		"texture": "res://assets/clan_logo/logo/herby_#image17509-2.webp"
	},
	"bear": {
		"texture": "res://assets/clan_logo/logo/herby_#image53807-4.webp"
	},
	"snake": {
		"texture": "res://assets/clan_logo/logo/herby_#image61082-5.webp"
	},
	"hazmat": {
		"texture": "res://assets/clan_logo/logo/herby_#image76603-8.webp"
	},
	"pirate": {
		"texture": "res://assets/clan_logo/logo/herby_#image91875-2.webp"
	},
	"dragon": {
		"texture": "res://assets/clan_logo/logo/herby_#image93678-3.webp"
	},
	"anchor": {
		"texture": "res://assets/clan_logo/logo/herby_#image114627-2.webp"
	},
	"castle": {
		"texture": "res://assets/clan_logo/logo/herby_#image122286-9.webp"
	},
	"chess_knight": {
		"texture": "res://assets/clan_logo/logo/herby_#image122693-7.webp"
	},
	"yoda": {
		"texture": "res://assets/clan_logo/logo/herby_#image137930-0.webp"
	},
}


static var shapes = {
	'rect': "res://assets/clan_logo/shape_bg/cl_#path185347-6-8.webp",
	'shield': "res://assets/clan_logo/shape_bg/cl_#path185355-1-6.webp",
	'shield_2': "res://assets/clan_logo/shape_bg/cl_#path185357-4-2.webp",
	'hex': "res://assets/clan_logo/shape_bg/cl_#path185359-7-2.webp",
}

static var patter_shape = {
	'empty': "res://assets/icons/close_w80.webp",
	'stright': "res://assets/clan_logo/inner_shape/cl_#path185349-5-3.webp",
	'angle': "res://assets/clan_logo/inner_shape/cl_#path185353-8-0.webp",
}

static var patters = {
	'ancient': "res://assets/clan_logo/pattern/cl_ancient_pattern.webp",
	'chest': "res://assets/clan_logo/pattern/cl_chest_pattern.webp",
	'fish': "res://assets/clan_logo/pattern/cl_fish_pattern.webp",
	'plus': "res://assets/clan_logo/pattern/cl_plus_pattern.webp",
	#'scribbles': "res://assets/clan_logo/pattern/cl_scribbles_pattern.webp",
	'snail': "res://assets/clan_logo/pattern/cl_snail_pattern.webp",
	'stripes': "res://assets/clan_logo/pattern/cl_stripes_pattern.webp",
}


static var premium_icons = [
	"pirate",
	"hazmat",
	"chess_knight",
	"f16",
	"bear_foot",
	"yoda",
	"castle",
	"warsaw",
	"lion",
	"wolf",
	"boar",
	"bear"
]

static var premium_shapes = [
	"hex",
	"shield"
]

static var premium_patterns = [
	"fish",
	"snail",
	"ancient"
]


static func get_asset_texture_set_by_name(name : String):
	if assets.has(name):
		return assets[name]
	else:
		return "res://assets/items/default_item.webp"


static func get_shape_texture_set_by_name(name : String):
	if shapes.has(name):
		return shapes[name]
	else:
		return "res://assets/items/default_item.webp"


static func get_pattern_shape_path_by_name(name : String):
	if patter_shape.has(name):
		return patter_shape[name]
	else:
		return "res://assets/items/default_item.webp"
		

static func get_pattern_path_by_name(name : String):
	if patters.has(name):
		return patters[name]
	else:
		return "res://assets/items/default_item.webp"


func _init():
	for n in assets.keys():
		print(n)
	
