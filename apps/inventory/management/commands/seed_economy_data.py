from django.core.management.base import BaseCommand

from apps.inventory.models import Item, ItemCategory


CATEGORIES = [
    {'name': 'Materials', 'slug': 'materials', 'order': 1},
    {'name': 'Building Blueprints', 'slug': 'blueprints-building', 'order': 2},
    {'name': 'Unit Blueprints', 'slug': 'blueprints-unit', 'order': 3},
    {'name': 'Ability Scrolls', 'slug': 'ability-scrolls', 'order': 4},
    {'name': 'Boosts', 'slug': 'boosts', 'order': 5},
    {'name': 'Crates', 'slug': 'crates', 'order': 6},
    {'name': 'Keys', 'slug': 'keys', 'order': 7},
    {'name': 'Cosmetics', 'slug': 'cosmetics', 'order': 8},
]

ITEMS = [
    # --- Materials ---
    {'name': 'Steel Scrap', 'slug': 'steel-scrap', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'common', 'icon': 'steel_scrap', 'base_value': 5},
    {'name': 'Circuit Board', 'slug': 'circuit-board', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'common', 'icon': 'circuit_board', 'base_value': 5},
    {'name': 'Fuel Cell', 'slug': 'fuel-cell', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'uncommon', 'icon': 'fuel_cell', 'base_value': 15},
    {'name': 'Gunpowder', 'slug': 'gunpowder', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'uncommon', 'icon': 'gunpowder', 'base_value': 15},
    {'name': 'Command Protocol', 'slug': 'command-protocol', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'rare', 'icon': 'command_protocol', 'base_value': 40},
    {'name': 'Optic Fiber', 'slug': 'optic-fiber', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'rare', 'icon': 'optic_fiber', 'base_value': 40},
    {'name': 'Plasma Core', 'slug': 'plasma-core', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'epic', 'icon': 'plasma_core', 'base_value': 120},
    {'name': 'Artifact Fragment', 'slug': 'artifact-fragment', 'category_slug': 'materials', 'item_type': 'material', 'rarity': 'legendary', 'icon': 'artifact_fragment', 'base_value': 350},

    # --- Building Blueprints ---
    {'name': 'Blueprint: Fortress', 'slug': 'bp-fortress', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_fortress', 'base_value': 80, 'is_consumable': True, 'blueprint_ref': 'fortress'},
    {'name': 'Blueprint: Refinery', 'slug': 'bp-refinery', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'rare', 'icon': 'bp_refinery', 'base_value': 80, 'is_consumable': True, 'blueprint_ref': 'refinery'},
    {'name': 'Blueprint: Radar', 'slug': 'bp-radar', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_radar', 'base_value': 50, 'is_consumable': True, 'blueprint_ref': 'radar'},
    {'name': 'Blueprint: Bunker', 'slug': 'bp-bunker', 'category_slug': 'blueprints-building', 'item_type': 'blueprint_building', 'rarity': 'uncommon', 'icon': 'bp_bunker', 'base_value': 50, 'is_consumable': True, 'blueprint_ref': 'bunker'},

    # --- Unit Blueprints ---
    {'name': 'Blueprint: Commandos', 'slug': 'bp-commandos', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'rare', 'icon': 'bp_commandos', 'base_value': 90, 'is_consumable': True, 'blueprint_ref': 'commandos'},
    {'name': 'Blueprint: Heavy Tank', 'slug': 'bp-heavy-tank', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'epic', 'icon': 'bp_heavy_tank', 'base_value': 150, 'is_consumable': True, 'blueprint_ref': 'heavy-tank'},
    {'name': 'Blueprint: Bomber', 'slug': 'bp-bomber', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'epic', 'icon': 'bp_bomber', 'base_value': 150, 'is_consumable': True, 'blueprint_ref': 'bomber'},
    {'name': 'Blueprint: Submarine', 'slug': 'bp-submarine', 'category_slug': 'blueprints-unit', 'item_type': 'blueprint_unit', 'rarity': 'legendary', 'icon': 'bp_submarine', 'base_value': 400, 'is_consumable': True, 'blueprint_ref': 'submarine'},

    # --- Ability Scrolls ---
    {'name': 'Scroll: Airstrike+', 'slug': 'scroll-airstrike-plus', 'category_slug': 'ability-scrolls', 'item_type': 'ability_scroll', 'rarity': 'rare', 'icon': 'scroll_airstrike', 'base_value': 70, 'is_consumable': True},
    {'name': 'Scroll: Shield+', 'slug': 'scroll-shield-plus', 'category_slug': 'ability-scrolls', 'item_type': 'ability_scroll', 'rarity': 'rare', 'icon': 'scroll_shield', 'base_value': 70, 'is_consumable': True},
    {'name': 'Scroll: Virus+', 'slug': 'scroll-virus-plus', 'category_slug': 'ability-scrolls', 'item_type': 'ability_scroll', 'rarity': 'epic', 'icon': 'scroll_virus', 'base_value': 130, 'is_consumable': True},

    # --- Boosts ---
    {'name': 'Boost: Mobilization', 'slug': 'boost-mobilization', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'uncommon', 'icon': 'boost_mobilization', 'base_value': 30, 'is_consumable': True,
     'boost_params': {'effect_type': 'unit_generation_bonus', 'value': 0.3, 'duration_ticks': 60}},
    {'name': 'Boost: Fortification', 'slug': 'boost-fortification', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'uncommon', 'icon': 'boost_fortification', 'base_value': 30, 'is_consumable': True,
     'boost_params': {'effect_type': 'defense_bonus', 'value': 0.2, 'duration_ticks': 0}},
    {'name': 'Boost: War Economy', 'slug': 'boost-war-economy', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'rare', 'icon': 'boost_war_economy', 'base_value': 50, 'is_consumable': True,
     'boost_params': {'effect_type': 'currency_generation_bonus', 'value': 0.5, 'duration_ticks': 0}},
    {'name': 'Boost: Blitzkrieg', 'slug': 'boost-blitzkrieg', 'category_slug': 'boosts', 'item_type': 'boost', 'rarity': 'rare', 'icon': 'boost_blitzkrieg', 'base_value': 50, 'is_consumable': True,
     'boost_params': {'effect_type': 'attack_bonus', 'value': 0.25, 'duration_ticks': 0}},

    # --- Crates ---
    {'name': 'Soldier Crate', 'slug': 'crate-soldier', 'category_slug': 'crates', 'item_type': 'crate', 'rarity': 'common', 'icon': 'crate_soldier', 'base_value': 20, 'is_consumable': True,
     'crate_loot_table': [
         {'item_slug': 'steel-scrap', 'weight': 40, 'min_qty': 2, 'max_qty': 5},
         {'item_slug': 'circuit-board', 'weight': 40, 'min_qty': 2, 'max_qty': 5},
         {'item_slug': 'fuel-cell', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'gunpowder', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'boost-mobilization', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
     ]},
    {'name': 'Officer Crate', 'slug': 'crate-officer', 'category_slug': 'crates', 'item_type': 'crate', 'rarity': 'uncommon', 'icon': 'crate_officer', 'base_value': 50, 'is_consumable': True,
     'crate_loot_table': [
         {'item_slug': 'fuel-cell', 'weight': 30, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'gunpowder', 'weight': 30, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'command-protocol', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'optic-fiber', 'weight': 15, 'min_qty': 1, 'max_qty': 2},
         {'item_slug': 'bp-radar', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-bunker', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
     ]},
    {'name': 'General Crate', 'slug': 'crate-general', 'category_slug': 'crates', 'item_type': 'crate', 'rarity': 'rare', 'icon': 'crate_general', 'base_value': 120, 'is_consumable': True,
     'crate_loot_table': [
         {'item_slug': 'command-protocol', 'weight': 25, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'optic-fiber', 'weight': 25, 'min_qty': 1, 'max_qty': 3},
         {'item_slug': 'plasma-core', 'weight': 15, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-fortress', 'weight': 8, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-refinery', 'weight': 8, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-commandos', 'weight': 7, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-heavy-tank', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'bp-bomber', 'weight': 5, 'min_qty': 1, 'max_qty': 1},
         {'item_slug': 'artifact-fragment', 'weight': 2, 'min_qty': 1, 'max_qty': 1},
     ]},

    # --- Keys ---
    {'name': 'Soldier Key', 'slug': 'key-soldier', 'category_slug': 'keys', 'item_type': 'key', 'rarity': 'common', 'icon': 'key_soldier', 'base_value': 15, 'is_consumable': True, 'opens_crate_slug': 'crate-soldier'},
    {'name': 'Officer Key', 'slug': 'key-officer', 'category_slug': 'keys', 'item_type': 'key', 'rarity': 'uncommon', 'icon': 'key_officer', 'base_value': 35, 'is_consumable': True, 'opens_crate_slug': 'crate-officer'},
    {'name': 'General Key', 'slug': 'key-general', 'category_slug': 'keys', 'item_type': 'key', 'rarity': 'rare', 'icon': 'key_general', 'base_value': 80, 'is_consumable': True, 'opens_crate_slug': 'crate-general'},

    # --- Cosmetics ---
    {'name': 'Desert Camo', 'slug': 'skin-desert-camo', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'uncommon', 'icon': 'skin_desert', 'base_value': 40},
    {'name': 'Arctic White', 'slug': 'skin-arctic-white', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'uncommon', 'icon': 'skin_arctic', 'base_value': 40},
    {'name': 'Blood Red', 'slug': 'skin-blood-red', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'rare', 'icon': 'skin_blood_red', 'base_value': 80},
    {'name': 'Golden Commander', 'slug': 'skin-golden-commander', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'epic', 'icon': 'skin_golden', 'base_value': 200},
    {'name': 'Skull Emblem', 'slug': 'emblem-skull', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'common', 'icon': 'emblem_skull', 'base_value': 15},
    {'name': 'Eagle Emblem', 'slug': 'emblem-eagle', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'uncommon', 'icon': 'emblem_eagle', 'base_value': 30},
    {'name': 'Dragon Emblem', 'slug': 'emblem-dragon', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'rare', 'icon': 'emblem_dragon', 'base_value': 60},
    {'name': 'Fire Trail', 'slug': 'effect-fire-trail', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'epic', 'icon': 'effect_fire', 'base_value': 180},
    {'name': 'Lightning Effect', 'slug': 'effect-lightning', 'category_slug': 'cosmetics', 'item_type': 'cosmetic', 'rarity': 'legendary', 'icon': 'effect_lightning', 'base_value': 500},
]

RECIPES = [
    # Building blueprints
    {'name': 'Craft Fortress Blueprint', 'slug': 'craft-bp-fortress', 'result_slug': 'bp-fortress', 'gold_cost': 50,
     'ingredients': [('steel-scrap', 10), ('command-protocol', 3), ('plasma-core', 1)]},
    {'name': 'Craft Refinery Blueprint', 'slug': 'craft-bp-refinery', 'result_slug': 'bp-refinery', 'gold_cost': 50,
     'ingredients': [('steel-scrap', 8), ('fuel-cell', 5), ('optic-fiber', 2)]},
    {'name': 'Craft Radar Blueprint', 'slug': 'craft-bp-radar', 'result_slug': 'bp-radar', 'gold_cost': 25,
     'ingredients': [('circuit-board', 8), ('optic-fiber', 3)]},
    {'name': 'Craft Bunker Blueprint', 'slug': 'craft-bp-bunker', 'result_slug': 'bp-bunker', 'gold_cost': 25,
     'ingredients': [('steel-scrap', 8), ('gunpowder', 4)]},
    # Unit blueprints
    {'name': 'Craft Commandos Blueprint', 'slug': 'craft-bp-commandos', 'result_slug': 'bp-commandos', 'gold_cost': 60,
     'ingredients': [('gunpowder', 5), ('command-protocol', 3), ('fuel-cell', 3)]},
    {'name': 'Craft Heavy Tank Blueprint', 'slug': 'craft-bp-heavy-tank', 'result_slug': 'bp-heavy-tank', 'gold_cost': 100,
     'ingredients': [('steel-scrap', 15), ('fuel-cell', 5), ('plasma-core', 2)]},
    {'name': 'Craft Bomber Blueprint', 'slug': 'craft-bp-bomber', 'result_slug': 'bp-bomber', 'gold_cost': 100,
     'ingredients': [('circuit-board', 10), ('fuel-cell', 5), ('plasma-core', 2)]},
    {'name': 'Craft Submarine Blueprint', 'slug': 'craft-bp-submarine', 'result_slug': 'bp-submarine', 'gold_cost': 200,
     'ingredients': [('steel-scrap', 20), ('optic-fiber', 5), ('plasma-core', 3), ('artifact-fragment', 1)]},
    # Ability scrolls
    {'name': 'Craft Airstrike+ Scroll', 'slug': 'craft-scroll-airstrike', 'result_slug': 'scroll-airstrike-plus', 'gold_cost': 40,
     'ingredients': [('gunpowder', 5), ('command-protocol', 2)]},
    {'name': 'Craft Shield+ Scroll', 'slug': 'craft-scroll-shield', 'result_slug': 'scroll-shield-plus', 'gold_cost': 40,
     'ingredients': [('steel-scrap', 5), ('circuit-board', 3), ('optic-fiber', 2)]},
    {'name': 'Craft Virus+ Scroll', 'slug': 'craft-scroll-virus', 'result_slug': 'scroll-virus-plus', 'gold_cost': 80,
     'ingredients': [('circuit-board', 8), ('command-protocol', 3), ('plasma-core', 1)]},
    # Boosts
    {'name': 'Craft Mobilization Boost', 'slug': 'craft-boost-mobilization', 'result_slug': 'boost-mobilization', 'gold_cost': 15,
     'ingredients': [('steel-scrap', 3), ('fuel-cell', 2)]},
    {'name': 'Craft Fortification Boost', 'slug': 'craft-boost-fortification', 'result_slug': 'boost-fortification', 'gold_cost': 15,
     'ingredients': [('steel-scrap', 5), ('gunpowder', 2)]},
    {'name': 'Craft War Economy Boost', 'slug': 'craft-boost-war-economy', 'result_slug': 'boost-war-economy', 'gold_cost': 30,
     'ingredients': [('circuit-board', 4), ('fuel-cell', 3)]},
    {'name': 'Craft Blitzkrieg Boost', 'slug': 'craft-boost-blitzkrieg', 'result_slug': 'boost-blitzkrieg', 'gold_cost': 30,
     'ingredients': [('gunpowder', 5), ('fuel-cell', 3)]},
    # Cosmetics
    {'name': 'Craft Desert Camo', 'slug': 'craft-skin-desert', 'result_slug': 'skin-desert-camo', 'gold_cost': 20,
     'ingredients': [('steel-scrap', 5), ('fuel-cell', 2)]},
    {'name': 'Craft Blood Red Skin', 'slug': 'craft-skin-blood-red', 'result_slug': 'skin-blood-red', 'gold_cost': 50,
     'ingredients': [('plasma-core', 1), ('gunpowder', 5)]},
    {'name': 'Craft Golden Commander', 'slug': 'craft-skin-golden', 'result_slug': 'skin-golden-commander', 'gold_cost': 150,
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
