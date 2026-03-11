extends Node
class_name ZoneTextures


const city_texture_data = {
	0: {
		"city_texture": "res://assets/zone/cities/city_1.webp",
		"city_position": Vector2(0, -40),
		"shadow_texture": "res://assets/zone/cities_shaddows/city_shaddow_1.webp",
		"inner_shadow_position": Vector2(-43, -26),
		"outer_shadow_position": Vector2(300, 162),
	},
	10: {
		"city_texture": "res://assets/zone/cities/city_2.webp",
		"city_position": Vector2(0, -90),
		"shadow_texture": "res://assets/zone/cities_shaddows/city_shaddow_2.webp",
		"inner_shadow_position": Vector2(-106, -58),
		"outer_shadow_position": Vector2(200, 150),
	},
	20: {
		"city_texture": "res://assets/zone/cities/city_3.webp",
		"city_position": Vector2(0, -130),
		"shadow_texture": "res://assets/zone/cities_shaddows/city_shaddow_3.webp",
		"inner_shadow_position": Vector2(-70, -71),
		"outer_shadow_position": Vector2(200, 150),
	},
	30: {
		"city_texture": "res://assets/zone/cities/city_4.webp",
		"city_position": Vector2(0, -150),
		"shadow_texture": "res://assets/zone/cities_shaddows/city_shaddow_4.webp",
		"inner_shadow_position": Vector2(-105, -85),
		"outer_shadow_position": Vector2(67, 68),
	},
	40: {
		"city_texture": "res://assets/zone/cities/city_5.webp",
		"city_position": Vector2(0, -145),
		"shadow_texture": "res://assets/zone/cities_shaddows/city_shaddow_5.webp",
		"inner_shadow_position": Vector2(-105, -86),
		"outer_shadow_position": Vector2(38, 43),
	},
	50: {
		"city_texture": "res://assets/zone/cities/city_6.webp",
		"city_position": Vector2(0, -159),
		"shadow_texture": "res://assets/zone/cities_shaddows/city_shaddow_6.webp",
		"inner_shadow_position": Vector2(-128, -71),
		"outer_shadow_position": Vector2(52, 62),
	}
}


static func get_city_texture_by_units_count(units_count : int):
	var last_matching = null
	for min_units in city_texture_data:
		if units_count >= min_units:
			last_matching = city_texture_data[min_units]
		else:
			return last_matching
	return last_matching
