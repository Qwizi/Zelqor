extends Node
class_name CountryStylesList


static var patterns = {
	'1': "res://assets/province_patterns/1.png",
	'2': "res://assets/province_patterns/2.png",
	'3': "res://assets/province_patterns/3.png",
	'4': "res://assets/province_patterns/4.png",
	'5': "res://assets/province_patterns/5.png",
	'6': "res://assets/province_patterns/6.png",
	'7': "res://assets/province_patterns/7.png",
	'8': "res://assets/province_patterns/8.png",
	'9': "res://assets/province_patterns/9.png",
	'10': "res://assets/province_patterns/10.png",
	'11': "res://assets/province_patterns/11.png",
	'12': "res://assets/province_patterns/12.png",
	'13': "res://assets/province_patterns/13.png",
	'14': "res://assets/province_patterns/14.png",
	'15': "res://assets/province_patterns/15.png",
	'16': "res://assets/province_patterns/16.png",
	'17': "res://assets/province_patterns/17.png",
	'18': "res://assets/province_patterns/18.png",
	'19': "res://assets/province_patterns/19.png",
	'20': "res://assets/province_patterns/20.png",
	'21': "res://assets/province_patterns/21.png",
	'22': "res://assets/province_patterns/22.png",
	'23': "res://assets/province_patterns/23.png",
	'24': "res://assets/province_patterns/24.png",
	'25': "res://assets/province_patterns/25.png",
	'26': "res://assets/province_patterns/26.png",
	'27': "res://assets/province_patterns/27.png",
	'28': "res://assets/province_patterns/28.png",
	'29': "res://assets/province_patterns/29.png",
	'30': "res://assets/province_patterns/30.png",
	'31': "res://assets/province_patterns/31.png",
	'32': "res://assets/province_patterns/32.png",
	'33': "res://assets/province_patterns/33.png",
	'34': "res://assets/province_patterns/34.png",
	'35': "res://assets/province_patterns/35.png",
	'36': "res://assets/province_patterns/36.png",
	'37': "res://assets/province_patterns/37.png",
	'38': "res://assets/province_patterns/38.png",
	'39': "res://assets/province_patterns/39.png",
	'40': "res://assets/province_patterns/40.png",
	'41': "res://assets/province_patterns/41.png",
	'42': "res://assets/province_patterns/42.png",
	'43': "res://assets/province_patterns/43.png",
	'44': "res://assets/province_patterns/44.png",
	'45': "res://assets/province_patterns/45.png",
	'46': "res://assets/province_patterns/46.png",
	'47': "res://assets/province_patterns/47.png",
	'48': "res://assets/province_patterns/48.png",
	'49': "res://assets/province_patterns/49.png",
	'50': "res://assets/province_patterns/50.png",
	'51': "res://assets/province_patterns/51.png"
}

static func get_pattern_path_by_name(name : String):
	if patterns.has(name):
		return patterns[name]
	else:
		return null
