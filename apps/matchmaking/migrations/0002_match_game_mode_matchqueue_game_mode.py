import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game_config", "0009_gamemode"),
        ("matchmaking", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="match",
            name="game_mode",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="matches",
                to="game_config.gamemode",
            ),
        ),
        migrations.AddField(
            model_name="matchqueue",
            name="game_mode",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="queue_entries",
                to="game_config.gamemode",
            ),
        ),
    ]
