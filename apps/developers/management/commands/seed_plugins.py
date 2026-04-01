"""Seed test plugins for development/demo purposes."""

from django.core.management.base import BaseCommand


SEED_PLUGINS = [
    {
        "name": "Speed Boost",
        "slug": "speed-boost",
        "description": "Increases unit movement speed by 50% during the first 30 seconds of each turn.",
        "long_description": "# Speed Boost Plugin\n\nA gameplay modifier that gives all units a 50% movement speed boost during the first 30 seconds of each turn. Great for fast-paced servers.",
        "category": "gameplay",
        "hooks": ["on_tick", "on_unit_move"],
        "tags": ["speed", "movement", "boost"],
        "version": "1.0.0",
    },
    {
        "name": "Double Resources",
        "slug": "double-resources",
        "description": "Doubles resource generation rate for all players. Makes games faster and more action-packed.",
        "long_description": "# Double Resources\n\nDoubles the base resource generation rate for every player. Buildings and capitals produce twice as much. Ideal for shorter, more aggressive matches.",
        "category": "economy",
        "hooks": ["on_tick", "on_economy_tick"],
        "tags": ["resources", "economy", "fast"],
        "version": "1.0.0",
    },
    {
        "name": "Fog of War Extended",
        "slug": "fog-of-war-extended",
        "description": "Extends fog of war mechanics with partial visibility zones around controlled regions.",
        "long_description": "# Fog of War Extended\n\nAdds partial visibility zones around player-controlled regions. Units in fog have reduced accuracy. Scouts reveal more area.",
        "category": "gameplay",
        "hooks": ["on_tick", "on_region_capture"],
        "tags": ["fog", "visibility", "tactical"],
        "version": "1.2.0",
    },
    {
        "name": "Chat Filter",
        "slug": "chat-filter",
        "description": "Filters inappropriate language from in-game chat messages.",
        "long_description": "# Chat Filter\n\nAutomatic profanity filter for match and lobby chat. Configurable word list and severity levels.",
        "category": "moderation",
        "hooks": ["on_chat_message"],
        "tags": ["chat", "moderation", "filter"],
        "version": "2.0.1",
    },
    {
        "name": "Auto Balance",
        "slug": "auto-balance",
        "description": "Automatically balances teams based on player ELO ratings before match start.",
        "long_description": "# Auto Balance\n\nAnalyzes player ELO ratings and automatically assigns teams to minimize skill difference. Works with 2v2, 3v3, and 4v4 modes.",
        "category": "gameplay",
        "hooks": ["on_match_start", "on_player_join"],
        "tags": ["balance", "teams", "matchmaking", "elo"],
        "version": "1.1.0",
    },
]


class Command(BaseCommand):
    help = "Seed test plugins for development and demo purposes"

    def handle(self, *args, **options):
        from apps.accounts.models import User
        from apps.developers.models import DeveloperApp, Plugin

        # Get or create a system user for seeded plugins
        system_user, _ = User.objects.get_or_create(
            username="zelqor-system",
            defaults={"email": "system@zelqor.dev", "is_staff": True},
        )

        # Get or create a system developer app
        app, _ = DeveloperApp.objects.get_or_create(
            name="Zelqor Official Plugins",
            defaults={
                "owner": system_user,
                "description": "Official plugins maintained by the Zelqor team",
            },
        )

        created_count = 0
        for plugin_data in SEED_PLUGINS:
            _, created = Plugin.objects.update_or_create(
                slug=plugin_data["slug"],
                defaults={
                    "app": app,
                    "name": plugin_data["name"],
                    "description": plugin_data["description"],
                    "long_description": plugin_data["long_description"],
                    "category": plugin_data["category"],
                    "hooks": plugin_data["hooks"],
                    "tags": plugin_data["tags"],
                    "version": plugin_data["version"],
                    "is_published": True,
                    "is_approved": True,
                },
            )
            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f"  Created plugin: {plugin_data['name']}"))
            else:
                self.stdout.write(f"  Updated plugin: {plugin_data['name']}")

        self.stdout.write(self.style.SUCCESS(f"\nDone: {created_count} new, {len(SEED_PLUGINS) - created_count} updated"))
