from io import BytesIO

from django.core.files.base import ContentFile
from django.db.models.fields.files import FieldFile
from PIL import Image as PILImage


def resize_image(image_field: FieldFile, max_size: int = 300, quality: int = 85) -> None:
    """Resize an image field in-place to fit within max_size x max_size, saved as WebP.

    Only processes newly uploaded files (in-memory). Already persisted files are skipped.
    """
    if not image_field:
        return

    # Only process in-memory uploads, not already-saved files
    file = image_field.file
    if not hasattr(file, "read"):
        return

    # Check if it's actually an in-memory upload (InMemoryUploadedFile or TemporaryUploadedFile)
    from django.core.files.uploadedfile import UploadedFile

    if not isinstance(file, UploadedFile):
        return

    file.seek(0)
    try:
        img = PILImage.open(file)
    except Exception:
        return

    img.thumbnail((max_size, max_size), PILImage.LANCZOS)

    img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")

    buffer = BytesIO()
    img.save(buffer, format="WEBP", quality=quality)
    buffer.seek(0)

    # Replace file with resized version, keeping the stem but changing extension
    original_name = image_field.name.rsplit("/", 1)[-1]
    stem = original_name.rsplit(".", 1)[0]
    image_field.save(f"{stem}.webp", ContentFile(buffer.read()), save=False)
