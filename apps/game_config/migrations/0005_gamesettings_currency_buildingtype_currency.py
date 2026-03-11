from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game_config", "0004_buildingtype_asset_key_unittype_asset_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamesettings",
            name="base_currency_per_tick",
            field=models.FloatField(
                default=2.0,
                help_text="Base currency generated per tick for each player",
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="region_currency_per_tick",
            field=models.FloatField(
                default=0.35,
                help_text="Currency generated per owned region each tick",
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="starting_currency",
            field=models.PositiveIntegerField(
                default=120,
                help_text="Starting strategic currency for each player",
            ),
        ),
        migrations.AddField(
            model_name="buildingtype",
            name="currency_cost",
            field=models.PositiveIntegerField(
                default=50,
                help_text="Currency cost to build",
            ),
        ),
        migrations.AddField(
            model_name="buildingtype",
            name="currency_generation_bonus",
            field=models.FloatField(
                default=0.0,
                help_text="Extra currency generated per tick by the region",
            ),
        ),
    ]
