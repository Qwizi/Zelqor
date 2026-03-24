from django.db import migrations

CLAN_LEVELS = [
    # level, experience_required, max_members, treasury_cap
    (1, 0, 10, 10000),
    (2, 100, 12, 15000),
    (3, 250, 14, 20000),
    (4, 500, 16, 30000),
    (5, 1000, 18, 40000),
    # Levels 6-10: XP doubles each level, +2 members, treasury +15000
    (6, 2000, 20, 55000),
    (7, 4000, 22, 70000),
    (8, 8000, 24, 85000),
    (9, 16000, 26, 100000),
    (10, 32000, 28, 115000),
    # Levels 11-20: XP *1.5 each level, +1 member, treasury +25000
    (11, 48000, 29, 140000),
    (12, 72000, 30, 165000),
    (13, 108000, 31, 190000),
    (14, 162000, 32, 215000),
    (15, 243000, 33, 240000),
    (16, 364500, 34, 265000),
    (17, 546750, 35, 290000),
    (18, 820125, 36, 315000),
    (19, 1230187, 37, 340000),
    (20, 1845280, 38, 365000),
]


def seed_clan_levels(apps, schema_editor):
    ClanLevel = apps.get_model("clans", "ClanLevel")
    objs = [
        ClanLevel(
            level=level,
            experience_required=xp,
            max_members=max_members,
            treasury_cap=treasury_cap,
            perks={},
        )
        for level, xp, max_members, treasury_cap in CLAN_LEVELS
    ]
    ClanLevel.objects.bulk_create(objs, ignore_conflicts=True)


def remove_clan_levels(apps, schema_editor):
    ClanLevel = apps.get_model("clans", "ClanLevel")
    ClanLevel.objects.filter(level__in=[row[0] for row in CLAN_LEVELS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("clans", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_clan_levels, remove_clan_levels),
    ]
