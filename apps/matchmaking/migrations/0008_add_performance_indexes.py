from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("matchmaking", "0007_lobby_full_at"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="match",
            index=models.Index(fields=["status", "created_at"], name="match_status_created_idx"),
        ),
        migrations.AddIndex(
            model_name="matchplayer",
            index=models.Index(fields=["match", "user", "is_alive"], name="mp_match_user_alive_idx"),
        ),
    ]
