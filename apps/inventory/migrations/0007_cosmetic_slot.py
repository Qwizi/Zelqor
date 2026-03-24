from django.db import migrations, models

ASSET_KEY_TO_COSMETIC_SLOT = {
    "infantry": "unit_infantry",
    "tank": "unit_tank",
    "ship": "unit_ship",
    "fighter": "unit_fighter",
    "barracks": "building_barracks",
    "factory": "building_factory",
    "tower": "building_tower",
    "port": "building_port",
    "carrier": "building_carrier",
    "radar": "building_radar",
    # These already match the new names
    "vfx_attack": "vfx_attack",
    "vfx_move": "vfx_move",
    "vfx_nuke": "vfx_nuke",
}

COSMETIC_SLOT_CHOICES = [
    ("unit_infantry", "Skin: Piechota"),
    ("unit_tank", "Skin: Czołg"),
    ("unit_ship", "Skin: Okręt"),
    ("unit_fighter", "Skin: Myśliwiec"),
    ("building_barracks", "Skin: Koszary"),
    ("building_factory", "Skin: Fabryka"),
    ("building_tower", "Skin: Wieża"),
    ("building_port", "Skin: Port"),
    ("building_carrier", "Skin: Lotniskowiec"),
    ("building_radar", "Skin: Elektrownia"),
    ("vfx_attack", "VFX: Atak"),
    ("vfx_move", "VFX: Ruch"),
    ("vfx_nuke", "VFX: Nuke"),
    ("vfx_capture", "VFX: Zdobycie"),
    ("vfx_defend", "VFX: Obrona"),
    ("vfx_elimination", "VFX: Eliminacja"),
    ("vfx_victory", "VFX: Zwycięstwo"),
    ("ability_conscription", "Skin: Pobór"),
    ("ability_recon", "Skin: Wywiad"),
    ("ability_shield", "Skin: Tarcza"),
    ("ability_virus", "Skin: Wirus"),
    ("ability_nuke", "Skin: Nuke"),
    ("emblem", "Emblemat"),
    ("profile_frame", "Ramka profilu"),
    ("player_title", "Tytuł"),
    ("flag", "Flaga"),
    ("sound_attack", "Dźwięk: Atak"),
    ("music_theme", "Muzyka: Motyw"),
]


def migrate_asset_key_to_cosmetic_slot(apps, schema_editor):
    Item = apps.get_model("inventory", "Item")
    EquippedCosmetic = apps.get_model("inventory", "EquippedCosmetic")

    # Migrate Item.cosmetic_slot values (renamed from asset_key)
    for old_value, new_value in ASSET_KEY_TO_COSMETIC_SLOT.items():
        Item.objects.filter(cosmetic_slot=old_value).update(cosmetic_slot=new_value)

    # Enforce is_stackable=False on all cosmetic items
    Item.objects.filter(item_type="cosmetic").update(is_stackable=False)

    # Migrate EquippedCosmetic.slot values
    for old_value, new_value in ASSET_KEY_TO_COSMETIC_SLOT.items():
        EquippedCosmetic.objects.filter(slot=old_value).update(slot=new_value)


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0006_iteminstance_deckitem_instance_and_more"),
    ]

    operations = [
        # Step 1: Rename asset_key to cosmetic_slot
        migrations.RenameField(
            model_name="item",
            old_name="asset_key",
            new_name="cosmetic_slot",
        ),
        # Step 2: Alter Item.cosmetic_slot to add choices and correct max_length
        migrations.AlterField(
            model_name="item",
            name="cosmetic_slot",
            field=models.CharField(
                blank=True,
                choices=COSMETIC_SLOT_CHOICES,
                help_text="Cosmetic slot for rendering (only for cosmetics)",
                max_length=30,
            ),
        ),
        # Step 3: Alter EquippedCosmetic.slot to add choices and correct max_length
        migrations.AlterField(
            model_name="equippedcosmetic",
            name="slot",
            field=models.CharField(
                choices=COSMETIC_SLOT_CHOICES,
                help_text="Cosmetic slot for rendering",
                max_length=30,
            ),
        ),
        # Step 4: Data migration — remap old values and enforce cosmetic constraints
        migrations.RunPython(
            migrate_asset_key_to_cosmetic_slot,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
