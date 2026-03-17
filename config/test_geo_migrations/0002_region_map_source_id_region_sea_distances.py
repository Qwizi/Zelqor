"""
Test-only stub for geo migration 0002 (already included in 0001 for tests).
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('geo', '0001_initial'),
    ]

    operations = []
