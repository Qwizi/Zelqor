"""Seed SystemModule for shop + default GemPackages."""

from django.db import migrations


def seed_shop_data(apps, schema_editor):
    SystemModule = apps.get_model("game_config", "SystemModule")
    GemPackage = apps.get_model("payments", "GemPackage")

    # Create the shop system module (feature toggle)
    SystemModule.objects.get_or_create(
        slug="shop",
        defaults={
            "name": "Sklep",
            "description": "Sklep z Gemsami, kosmetykami i kluczami",
            "icon": "diamond",
            "module_type": "system",
            "enabled": True,
            "affects_backend": True,
            "affects_frontend": True,
            "affects_gateway": False,
            "is_core": False,
            "order": 50,
        },
    )

    # Seed default gem packages
    packages = [
        {
            "name": "Mały Worek",
            "slug": "small-pack",
            "gems": 100,
            "bonus_gems": 0,
            "price_cents": 99,
            "icon": "gem-small",
            "order": 1,
        },
        {
            "name": "Średni Worek",
            "slug": "medium-pack",
            "gems": 500,
            "bonus_gems": 25,
            "price_cents": 499,
            "icon": "gem-medium",
            "order": 2,
        },
        {
            "name": "Duży Worek",
            "slug": "large-pack",
            "gems": 1200,
            "bonus_gems": 100,
            "price_cents": 999,
            "icon": "gem-large",
            "order": 3,
            "is_featured": True,
        },
        {
            "name": "Mega Worek",
            "slug": "mega-pack",
            "gems": 2500,
            "bonus_gems": 250,
            "price_cents": 1999,
            "icon": "gem-mega",
            "order": 4,
        },
        {
            "name": "Skrzynia Skarbów",
            "slug": "treasure-chest",
            "gems": 6500,
            "bonus_gems": 1000,
            "price_cents": 4999,
            "icon": "gem-treasure",
            "order": 5,
            "is_featured": True,
        },
    ]
    for pkg in packages:
        GemPackage.objects.get_or_create(slug=pkg["slug"], defaults=pkg)


def reverse_seed(apps, schema_editor):
    SystemModule = apps.get_model("game_config", "SystemModule")
    GemPackage = apps.get_model("payments", "GemPackage")
    SystemModule.objects.filter(slug="shop").delete()
    GemPackage.objects.filter(
        slug__in=["small-pack", "medium-pack", "large-pack", "mega-pack", "treasure-chest"]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0001_initial"),
        ("game_config", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_shop_data, reverse_seed),
    ]
