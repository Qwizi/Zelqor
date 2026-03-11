extends Node
class_name RankList


const assets = {
	## bronze
	"b1": "res://assets/ranks/1.webp",
	"b2": "res://assets/ranks/2.webp",
	"b3": "res://assets/ranks/3.webp",
	"b4": "res://assets/ranks/4.webp",
	"b5": "res://assets/ranks/5.webp",
	
	## silver
	"s1": "res://assets/ranks/6.webp",
	"s2": "res://assets/ranks/7.webp",
	"s3": "res://assets/ranks/8.webp",
	"s4": "res://assets/ranks/9.webp",
	"s5": "res://assets/ranks/10.webp",
	
	## gilded steel
	"gs1": "res://assets/ranks/16.webp",
	"gs2": "res://assets/ranks/17.webp",
	"gs3": "res://assets/ranks/18.webp",
	"gs4": "res://assets/ranks/19.webp",
	"gs5": "res://assets/ranks/20.webp",
	
	## gold
	"g1": "res://assets/ranks/11.webp",
	"g2": "res://assets/ranks/12.webp",
	"g3": "res://assets/ranks/13.webp",
	"g4": "res://assets/ranks/14.webp",
	"g5": "res://assets/ranks/15.webp",
	
	## generls, maplord
	"u1": "res://assets/ranks/21.webp",
	"u2": "res://assets/ranks/22.webp",
	"u3": "res://assets/ranks/23.webp",
	"u4": "res://assets/ranks/24.webp",
	"u5": "res://assets/ranks/25.webp",
}

static func get_asset_texture_path_by_name(name : String):
	if assets.has(name):
		return assets[name]
	else: 
		return assets["b1"]
