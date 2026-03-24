from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="mapconfig",
            name="min_capital_distance",
            field=models.PositiveIntegerField(
                default=3,
                help_text="Minimum hop distance between starting capitals (0 = no restriction).",
            ),
        ),
    ]
