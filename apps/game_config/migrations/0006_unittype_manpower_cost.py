from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0005_gamesettings_currency_buildingtype_currency"),
    ]

    operations = [
        migrations.AddField(
            model_name="unittype",
            name="manpower_cost",
            field=models.PositiveIntegerField(
                default=1,
                help_text="How many base units are consumed to produce one token of this unit",
            ),
        ),
    ]
