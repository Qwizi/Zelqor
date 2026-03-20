from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db.models import Count

from apps.inventory.models import Deck

User = get_user_model()


class Command(BaseCommand):
    help = "Remove duplicate default decks, keeping only the newest one per user"

    def handle(self, *args, **options):
        total_deleted = 0
        for user in User.objects.all():
            # Remove all non-editable decks except the one marked as default.
            # These are stale copies from repeated provisioning.
            stale = Deck.objects.filter(user=user, is_editable=False, is_default=False)
            stale_count = stale.count()
            if stale_count > 0:
                stale.delete()
                total_deleted += stale_count
                self.stdout.write(f"  {user.username}: removed {stale_count} stale non-editable deck(s)")

            # If there are multiple is_default=True decks, keep only the newest
            default_decks = Deck.objects.filter(user=user, is_default=True).order_by('-created_at')
            if default_decks.count() > 1:
                keep = default_decks.first()
                to_delete = default_decks.exclude(pk=keep.pk)
                deleted_count = to_delete.count()
                to_delete.delete()
                total_deleted += deleted_count
                self.stdout.write(f"  {user.username}: removed {deleted_count} duplicate default deck(s)")

        if total_deleted == 0:
            self.stdout.write(self.style.SUCCESS("No duplicate decks found."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Cleaned up {total_deleted} deck(s) total."))
