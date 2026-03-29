"""Create or retrieve the Official Gamenode DeveloperApp.

Idempotent — safe to run multiple times.  On first run it creates a
DeveloperApp + CommunityServer and writes GAMENODE_CLIENT_ID and
GAMENODE_CLIENT_SECRET to the .env file.  On subsequent runs it's a no-op.
"""

import re
import uuid
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.developers.models import CommunityServer, DeveloperApp

# Deterministic UUID so the command is idempotent.
OFFICIAL_APP_UUID = uuid.UUID("00000000-0000-4000-a000-000000000001")
OFFICIAL_SERVER_UUID = uuid.UUID("00000000-0000-4000-a000-000000000002")
SERVICE_ACCOUNT_UUID = uuid.UUID("00000000-0000-4000-a000-000000000099")


def _update_env_file(key: str, value: str) -> None:
    """Set key=value in .env, appending if missing, replacing if present."""
    env_path = Path(".env")
    if env_path.exists():
        content = env_path.read_text()
        pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
        if pattern.search(content):
            content = pattern.sub(f"{key}={value}", content)
        else:
            content = content.rstrip("\n") + f"\n{key}={value}\n"
        env_path.write_text(content)
    else:
        env_path.write_text(f"{key}={value}\n")


class Command(BaseCommand):
    help = "Create the Official Gamenode DeveloperApp and CommunityServer (idempotent)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--region",
            default="eu-west",
            help="Region for the official server (default: eu-west)",
        )
        parser.add_argument(
            "--max-players",
            type=int,
            default=200,
            help="Max concurrent players (default: 200)",
        )

    def handle(self, *args, **options):
        # Ensure a service account user exists to own the app.
        owner, _ = User.objects.get_or_create(
            id=SERVICE_ACCOUNT_UUID,
            defaults={
                "username": "system-gamenode",
                "email": "gamenode@zelqor.internal",
                "is_active": False,  # not a real login account
            },
        )

        app = DeveloperApp.objects.filter(id=OFFICIAL_APP_UUID).first()

        if app is None:
            # First run — create app and write credentials to .env.
            raw_secret, secret_hash = DeveloperApp.generate_secret()
            app = DeveloperApp.objects.create(
                id=OFFICIAL_APP_UUID,
                name="Official Gamenode",
                description="System app for the official game server",
                owner=owner,
                client_secret_hash=secret_hash,
            )
            _update_env_file("GAMENODE_CLIENT_ID", app.client_id)
            _update_env_file("GAMENODE_CLIENT_SECRET", raw_secret)
            self.stdout.write(self.style.SUCCESS("Created Official Gamenode app — credentials written to .env"))
        else:
            self.stdout.write("Official Gamenode app already exists")

        # Ensure the CommunityServer record exists.
        _server, created = CommunityServer.objects.get_or_create(
            id=OFFICIAL_SERVER_UUID,
            defaults={
                "app": app,
                "name": "Official Server",
                "description": "The official Zelqor ranked game server",
                "region": options["region"],
                "max_players": options["max_players"],
                "is_public": True,
                "is_verified": True,
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS("Created Official CommunityServer"))
        else:
            self.stdout.write("Official CommunityServer already exists")
