from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("geo", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="region",
            name="map_source_id",
            field=models.PositiveIntegerField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="region",
            name="sea_distances",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
