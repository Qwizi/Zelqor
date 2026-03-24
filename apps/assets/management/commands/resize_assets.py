from io import BytesIO

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image as PILImage

from apps.assets.models import AssetCategory, GameAsset


class Command(BaseCommand):
    help = "Resize all existing image GameAssets to fit within max_size (default 300px)"

    def add_arguments(self, parser):
        parser.add_argument("--max-size", type=int, default=300, help="Max width/height in pixels")
        parser.add_argument("--quality", type=int, default=85, help="WebP quality")
        parser.add_argument("--dry-run", action="store_true", help="Only report, do not modify")

    def handle(self, *args, **options):
        max_size = options["max_size"]
        quality = options["quality"]
        dry_run = options["dry_run"]

        image_categories = {
            AssetCategory.BUILDING,
            AssetCategory.UNIT,
            AssetCategory.ABILITY,
            AssetCategory.ICON,
            AssetCategory.TEXTURE,
        }
        assets = GameAsset.objects.filter(
            category__in=image_categories,
            is_active=True,
        ).exclude(file="")

        resized = 0
        for asset in assets:
            try:
                asset.file.open("rb")
                img = PILImage.open(asset.file)
                w, h = img.size

                if w <= max_size and h <= max_size:
                    asset.file.close()
                    continue

                self.stdout.write(f"{asset.key}: {w}x{h} -> ", ending="")

                if dry_run:
                    self.stdout.write("(would resize)")
                    asset.file.close()
                    resized += 1
                    continue

                img.thumbnail((max_size, max_size), PILImage.LANCZOS)
                img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")

                buf = BytesIO()
                img.save(buf, format="WEBP", quality=quality)
                buf.seek(0)

                stem = asset.file.name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                asset.file.save(f"{stem}.webp", ContentFile(buf.read()), save=False)
                asset.save(update_fields=["file", "updated_at"])

                self.stdout.write(f"{img.size[0]}x{img.size[1]} OK")
                resized += 1
            except Exception as e:
                self.stderr.write(f"{asset.key}: error - {e}")

        action = "Would resize" if dry_run else "Resized"
        self.stdout.write(self.style.SUCCESS(f"{action} {resized} asset(s)"))
