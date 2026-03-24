from django.db import migrations


def seed_ability_types(apps, schema_editor):
    AbilityType = apps.get_model("game_config", "AbilityType")

    abilities = [
        {
            "name": "Nuke",
            "slug": "ab_province_nuke",
            "asset_key": "ab_province_nuke",
            "description": "Natychmiastowe uderzenie nuklearne zabijające jednostki w prowincji.",
            "icon": "☢️",
            "sound_key": "nuke",
            "target_type": "enemy",
            "range": 1,
            "currency_cost": 80,
            "cooldown_ticks": 60,
            "damage": 50,
            "effect_duration_ticks": 0,
            "effect_params": {},
            "order": 0,
        },
        {
            "name": "Virus",
            "slug": "ab_virus",
            "asset_key": "ab_virus",
            "description": "Rozprzestrzenia wirusa zabijającego jednostki i redukującego produkcję.",
            "icon": "🦠",
            "sound_key": "virus",
            "target_type": "enemy",
            "range": 2,
            "currency_cost": 100,
            "cooldown_ticks": 90,
            "damage": 0,
            "effect_duration_ticks": 15,
            "effect_params": {
                "production_reduction": 0.5,
                "unit_kill_percent": 0.05,
                "spread_range": 1,
            },
            "order": 1,
        },
        {
            "name": "Submarine",
            "slug": "ab_pr_submarine",
            "asset_key": "ab_pr_submarine",
            "description": "Ujawnia jednostki wroga w prowincji na określony czas.",
            "icon": "🔍",
            "sound_key": "submarine",
            "target_type": "enemy",
            "range": 3,
            "currency_cost": 40,
            "cooldown_ticks": 45,
            "damage": 0,
            "effect_duration_ticks": 10,
            "effect_params": {},
            "order": 2,
        },
        {
            "name": "Shield",
            "slug": "ab_shield",
            "asset_key": "ab_shield",
            "description": "Tworzy tarczę blokującą ataki na prowincję.",
            "icon": "🛡️",
            "sound_key": "shield",
            "target_type": "own",
            "range": 0,
            "currency_cost": 60,
            "cooldown_ticks": 60,
            "damage": 0,
            "effect_duration_ticks": 20,
            "effect_params": {},
            "order": 3,
        },
        {
            "name": "Conscription",
            "slug": "ab_conscription_point",
            "asset_key": "ab_conscription_point",
            "description": "Zbiera procent jednostek z neutralnych sąsiednich prowincji.",
            "icon": "📯",
            "sound_key": "quick_gain",
            "target_type": "own",
            "range": 0,
            "currency_cost": 50,
            "cooldown_ticks": 45,
            "damage": 0,
            "effect_duration_ticks": 0,
            "effect_params": {
                "collect_percent": 0.3,
            },
            "order": 4,
        },
    ]

    for ability in abilities:
        AbilityType.objects.update_or_create(
            slug=ability["slug"],
            defaults=ability,
        )


def reverse_seed(apps, schema_editor):
    AbilityType = apps.get_model("game_config", "AbilityType")
    AbilityType.objects.filter(
        slug__in=[
            "ab_province_nuke",
            "ab_virus",
            "ab_pr_submarine",
            "ab_shield",
            "ab_conscription_point",
        ]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0010_abilitytype"),
    ]

    operations = [
        migrations.RunPython(seed_ability_types, reverse_seed),
    ]
