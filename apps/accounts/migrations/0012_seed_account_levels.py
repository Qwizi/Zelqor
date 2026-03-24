import math

from django.db import migrations


def _build_account_levels():
    """
    Build level data for levels 1-50 with smooth exponential XP growth and
    Polish military rank titles.

    Boundaries (level -> (xp, title)):
      1        0           Rekrut
      2        50          Rekrut
      3-5      100-300     Żołnierz
      6-10     500-2000    Kapral
      11-15    3000-8000   Sierżant
      16-20    10000-25000 Porucznik
      21-30    30000-100000 Kapitan
      31-40    120000-400000 Major
      41-50    500000-2000000 Generał
    """
    # Each tier: (start_level, end_level, start_xp, end_xp, title)
    tiers = [
        (1, 1, 0, 0, "Rekrut"),
        (2, 2, 50, 50, "Rekrut"),
        (3, 5, 100, 300, "Żołnierz"),
        (6, 10, 500, 2000, "Kapral"),
        (11, 15, 3000, 8000, "Sierżant"),
        (16, 20, 10000, 25000, "Porucznik"),
        (21, 30, 30000, 100000, "Kapitan"),
        (31, 40, 120000, 400000, "Major"),
        (41, 50, 500000, 2000000, "Generał"),
    ]

    levels = {}
    for start, end, xp_start, xp_end, title in tiers:
        count = end - start + 1
        if count == 1:
            levels[start] = (xp_start, title)
        else:
            # Exponential interpolation between xp_start and xp_end
            for i in range(count):
                lv = start + i
                t = i / (count - 1)
                xp = int(xp_end * t) if xp_start == 0 else int(xp_start * math.exp(t * math.log(xp_end / xp_start)))
                levels[lv] = (xp, title)

    return levels


ACCOUNT_LEVELS = _build_account_levels()


def seed_account_levels(apps, schema_editor):
    AccountLevel = apps.get_model("accounts", "AccountLevel")
    objs = [
        AccountLevel(
            level=lv,
            experience_required=xp,
            title=title,
            perks={},
        )
        for lv, (xp, title) in sorted(ACCOUNT_LEVELS.items())
    ]
    AccountLevel.objects.bulk_create(objs, ignore_conflicts=True)


def remove_account_levels(apps, schema_editor):
    AccountLevel = apps.get_model("accounts", "AccountLevel")
    AccountLevel.objects.filter(level__in=list(ACCOUNT_LEVELS.keys())).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0011_accountlevel_and_user_xp_fields"),
    ]

    operations = [
        migrations.RunPython(seed_account_levels, remove_account_levels),
    ]
