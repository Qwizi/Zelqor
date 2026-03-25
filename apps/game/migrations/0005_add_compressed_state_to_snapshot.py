from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game", "0004_anticheatviolation"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamestatesnapshot",
            name="compressed_state",
            field=models.BinaryField(
                blank=True,
                help_text="zstd-compressed JSON game state (~90% smaller than JSONField)",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="gamestatesnapshot",
            name="state_data",
            field=models.JSONField(
                blank=True,
                default=None,
                help_text="Legacy uncompressed state (nullable, new snapshots use compressed_state)",
                null=True,
            ),
        ),
    ]
