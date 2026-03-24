from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0006_unittype_manpower_cost"),
    ]

    operations = [
        migrations.AddField(
            model_name="unittype",
            name="sea_hop_distance_km",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Max maritime hop distance in km for sea units (0 = use global fallback)",
            ),
        ),
    ]
