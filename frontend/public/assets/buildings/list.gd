extends Node
class_name BuildingList


const assets = {
	"sawmill": "res://assets/buildings/tartak.png",
	"town_hall": "res://assets/buildings/ratusz.png",
	"airport": "res://assets/buildings/airport.png",
	"ironworks": "res://assets/buildings/ironworks.png",
	"power_plant": "res://assets/buildings/power_plant.png",
	"hospital": "res://assets/buildings/hospital.png",
	"military_base": "res://assets/buildings/military_base.png",
	"navy_port": "res://assets/buildings/navy_port.png",
	"mine": "res://assets/buildings/mine.png"
}

const building_texture_data = {
	"sawmill": {
		"0": {
			"texture": "res://assets/buildings/v2/sawmill_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/sawmill_s_h300.webp",
			"shadow_scale": 1.026,
			"shadow_offset": Vector2(-27,-11),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
			
		}
	},
	"airport": {
		"0": {
			"texture": "res://assets/buildings/v2/airport_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/airport_s_h300.webp",
			"shadow_scale": 1.139,
			"shadow_offset": Vector2(-58,30),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
	"ironworks": {
		"0": {
			"texture": "res://assets/buildings/v2/ironworks_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/ironworks_s_h300.webp",
			"shadow_scale": 1.385,
			"shadow_offset": Vector2(-64,41),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
	"power_plant": {
		"0": {
			"texture": "res://assets/buildings/v2/powerplant1_w300.webp",
			"texture_scale": 0.67,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/powerplant1_s_h300.webp",
			"shadow_scale": 1.445,
			"shadow_offset": Vector2(-67,53),
			"animations": {
				"built": [
					{
						"animation": "smoke",
						"scale": Vector2(.47,.47),
						"position": Vector2(121, -246)
					}
				],
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		},
		"1": {
			"texture": "res://assets/buildings/v2/powerplant2_w300.webp",
			"texture_scale": 0.72,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/powerplant2_s_h300.webp",
			"shadow_scale": 1.596,
			"shadow_offset": Vector2(-90,85),
			"animations": {
				"built": [
					{
						"animation": "smoke",
						"scale": Vector2(.47,.47),
						"position": Vector2(-26.08, -237.79)
					}, {
						"animation": "smoke",
						"scale": Vector2(.47,.47),
						"position": Vector2(-100.03, -186.86)
					}
				],
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		},
		"2": {
			"texture": "res://assets/buildings/v2/powerplant3_w300.webp",
			"texture_scale": 0.8,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/powerplant3_s_h300.webp",
			"shadow_scale": 0.986,
			"shadow_offset": Vector2(-62,19),
			"animations": {
				"built": [
					{
						"animation": "smoke",
						"scale": Vector2(.47,.47),
						"position": Vector2(55.51, -225.55)
					}, {
						"animation": "smoke",
						"scale": Vector2(.47,.47),
						"position": Vector2(110.15, -187.6)
					}, {
						"animation": "smoke",
						"scale": Vector2(.3,.3),
						"position": Vector2(6.46, -126.47)
					}
				],
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		},
		"3": {
			"texture": "res://assets/buildings/v2/powerplant4_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/powerplant4_s_h300.webp",
			"shadow_scale": 1.284,
			"shadow_offset": Vector2(-54,22)
		},
	},
	"military_base": {
		"0": {
			"texture": "res://assets/buildings/v2/militarybase_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/militarybase_s_h300.webp",
			"shadow_scale": 1.467,
			"shadow_offset": Vector2(-63,45),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
	"navy_port": {
		"0": {
			"texture": "res://assets/buildings/v2/navyport_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/militarybase_s_h300.webp",
			"shadow_scale": 1.454,
			"shadow_offset": Vector2(-69,80),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
	"mine": {
		"0": {
			"texture": "res://assets/buildings/v2/mine_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/mine_s_h300.webp",
			"shadow_scale": 1.136,
			"shadow_offset": Vector2(-62,32),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
	"barracks": {
		"0": {
			"texture": "res://assets/buildings/v2/barracks3_w300.webp",
			"texture_scale": 0.84,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/barracks3_s_h300.webp",
			"shadow_scale": 1.068,
			"shadow_offset": Vector2(-44,-8),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		},
		#"0-old": {
			#"texture": "res://assets/buildings/v2/barracks1_w300.webp",
			#"texture_scale": 0.86,
			#"texture_offset": Vector2(0,0),
			#"shadow_texture": "res://assets/buildings/v2_shadows/barracks1_s_h300.webp",
			#"shadow_scale": 1.065,
			#"shadow_offset": Vector2(-43,11)
		#},
		#"1": {
			#"texture": "res://assets/buildings/v2/barracks2_w300.webp",
			#"texture_scale": 1,
			#"texture_offset": Vector2(0,0),
			#"shadow_texture": "res://assets/buildings/v2_shadows/barracks2_s_h300.webp",
			#"shadow_scale": 0.893,
			#"shadow_offset": Vector2(-34,5)
		#},
		#"2": {
			#"texture": "res://assets/buildings/v2/barracks3_w300.webp",
			#"texture_scale": 0.84,
			#"texture_offset": Vector2(0,0),
			#"shadow_texture": "res://assets/buildings/v2_shadows/barracks3_s_h300.webp",
			#"shadow_scale": 1.068,
			#"shadow_offset": Vector2(-44,-8)
		#},
		#"3": {
			#"texture": "res://assets/buildings/v2/barracks4_w300.webp",
			#"texture_scale": 0.84,
			#"texture_offset": Vector2(0,0),
			#"shadow_texture": "res://assets/buildings/v2_shadows/barracks4_s_h300.webp",
			#"shadow_scale": 1.079,
			#"shadow_offset": Vector2(-32,7)
		#},
	},
	"lab": {
		"0": {
			"texture": "res://assets/buildings/v2/lab_w300.webp",
			"texture_scale": 0.75,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/lab_s_h300.webp",
			"shadow_scale": 1.482,
			"shadow_offset": Vector2(-73,32),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		},
		"1": {
			"texture": "res://assets/buildings/v2/lab2_w300.webp",
			"texture_scale": 0.83,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/lab2_s_w300.webp",
			"shadow_scale": 1.337,
			"shadow_offset": Vector2(-59,38),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		},
		"2": {
			"texture": "res://assets/buildings/v2/lab3_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/lab3_s_w300.webp",
			"shadow_scale": 1.199,
			"shadow_offset": Vector2(-34,24),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
	"sentry": {
		"0": {
			"texture": "res://assets/buildings/v2/sentry_w300.webp",
			"texture_scale": 1,
			"texture_offset": Vector2(0,0),
			"shadow_texture": "res://assets/buildings/v2_shadows/sentry_s_h300.webp",
			"shadow_scale": 1.396,
			"shadow_offset": Vector2(-65,22),
			"animations": {
				"disabled_by_effect": [
					{
						"animation": "smoke",
						"scale": Vector2(2.25,2),
						"position": Vector2(-10,-92),
						"modulate": Color("#674439dc")
					}
				]
			},
			"effects": {
				"disabled_by_effect": {
					"texture_modulate": Color("#966b53")
				}
			}
		}
	},
}

static func get_asset_texture_path_by_name(name : String):
	if assets.has(name):
		return assets[name]


static func get_building_texture_data(name : String, level : int = 0):
	if building_texture_data.has(name):
		if building_texture_data[name].has(str(level)):
			return building_texture_data[name][str(level)]
	return null
	
#static func get_textures_iid()
