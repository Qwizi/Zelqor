from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clans', '0002_seed_clan_levels'),
    ]

    operations = [
        migrations.AddField(
            model_name='clanwar',
            name='scheduled_at',
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text='When the war is scheduled to start (None = start immediately upon acceptance)',
            ),
        ),
    ]
