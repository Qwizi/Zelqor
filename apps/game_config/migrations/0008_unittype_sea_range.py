from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game_config", "0007_unittype_sea_hop_distance_km"),
    ]

    operations = [
        migrations.AddField(
            model_name="unittype",
            name="sea_range",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Sea distance score for maritime reach on custom maps (0 = disabled)",
            ),
        ),
    ]
