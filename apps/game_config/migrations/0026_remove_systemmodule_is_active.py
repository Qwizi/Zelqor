from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0025_merge_gamemodule_into_systemmodule"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="systemmodule",
            name="is_active",
        ),
    ]
