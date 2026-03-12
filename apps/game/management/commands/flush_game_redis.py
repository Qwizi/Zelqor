import redis
from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Flush all game state and tile cache from Redis. Use after deploy or load_game_config."

    def handle(self, *args, **options):
        # Flush game state keys (game:{match_id}:*)
        r = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_GAME_DB,
        )
        game_keys = list(r.scan_iter(match="game:*"))
        game_deleted = r.delete(*game_keys) if game_keys else 0
        r.close()

        if game_deleted:
            self.stdout.write(f"  Game state: {game_deleted} keys deleted")
        else:
            self.stdout.write("  Game state: no keys found")

        # Flush Django cache (mvt tiles, match_country_codes, etc.)
        cache.clear()
        self.stdout.write("  Django cache: cleared (MVT tiles, match data)")

        self.stdout.write(self.style.SUCCESS("Redis flush complete."))
