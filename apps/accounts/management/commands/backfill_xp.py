"""
Backfill account XP and levels based on already-played matches.

Winner: +50 XP per match, Loser: +20 XP per match.
Also forwards clan XP via award_clan_xp task.
"""

from django.core.management.base import BaseCommand

from apps.accounts.models import AccountLevel, User


class Command(BaseCommand):
    help = "Backfill player XP/levels from historical match results"

    def handle(self, *args, **options):
        from apps.game.models import MatchPlayerResult

        # Build level thresholds
        thresholds = list(AccountLevel.objects.order_by("level").values_list("level", "experience_required"))
        if not thresholds:
            self.stderr.write("No AccountLevel data — run migrations first.")
            return

        results = MatchPlayerResult.objects.select_related("user").all()
        xp_by_user: dict[str, int] = {}

        for r in results:
            uid = str(r.user_id)
            if r.is_winner:
                xp_by_user[uid] = xp_by_user.get(uid, 0) + 50
            else:
                xp_by_user[uid] = xp_by_user.get(uid, 0) + 20

        if not xp_by_user:
            self.stdout.write("No match results found — nothing to backfill.")
            return

        users = User.objects.filter(id__in=list(xp_by_user.keys()))
        updated = 0

        for user in users:
            uid = str(user.id)
            total_xp = xp_by_user.get(uid, 0)
            if total_xp <= 0:
                continue

            user.experience = total_xp

            # Determine level from thresholds
            new_level = 1
            for lvl, xp_req in thresholds:
                if total_xp >= xp_req:
                    new_level = lvl
                else:
                    break
            user.level = new_level
            updated += 1

        if updated:
            User.objects.bulk_update(users, ["experience", "level"])

        self.stdout.write(self.style.SUCCESS(f"Updated {updated} users with XP from match history."))

        # Forward clan XP
        from apps.clans.tasks import award_clan_xp

        forwarded = 0
        for uid, xp in xp_by_user.items():
            try:
                award_clan_xp.delay(uid, xp)
                forwarded += 1
            except Exception:
                pass

        self.stdout.write(f"Dispatched clan XP for {forwarded} users.")
