from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0017_remove_abilitytype_image_remove_abilitytype_sound_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamesettings",
            name="weather_enabled",
            field=models.BooleanField(default=True, help_text="Enable weather effects (rain, fog, storm)"),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="day_night_enabled",
            field=models.BooleanField(default=True, help_text="Enable day/night cycle"),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="weather_enabled",
            field=models.BooleanField(default=True, help_text="Enable weather effects (rain, fog, storm)"),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="day_night_enabled",
            field=models.BooleanField(default=True, help_text="Enable day/night cycle"),
        ),
    ]
