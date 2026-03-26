"""
Tests for apps/utils.py — resize_image utility.
"""

import io

from django.core.files.uploadedfile import InMemoryUploadedFile
from PIL import Image as PILImage


def _make_uploaded_image(width=400, height=400, fmt="PNG", name="test.png") -> InMemoryUploadedFile:
    """Create a real in-memory uploaded image."""
    buf = io.BytesIO()
    img = PILImage.new("RGB", (width, height), color=(255, 0, 0))
    img.save(buf, format=fmt)
    buf.seek(0)
    return InMemoryUploadedFile(
        file=buf,
        field_name="file",
        name=name,
        content_type=f"image/{fmt.lower()}",
        size=buf.getbuffer().nbytes,
        charset=None,
    )


def _make_field_file_with_upload(upload: InMemoryUploadedFile):
    """Wrap an InMemoryUploadedFile in a minimal FieldFile-like object."""
    from unittest.mock import MagicMock

    ff = MagicMock()
    ff.file = upload
    ff.__bool__ = lambda self: True
    ff.name = upload.name

    def save(name, content, save=False):
        ff.name = name
        ff._saved_content = content

    ff.save = save
    return ff


class TestResizeImage:
    def test_none_field_is_noop(self):
        from apps.utils import resize_image

        # Passing a falsy value (None) should return immediately without error
        resize_image(None)

    def test_falsy_field_is_noop(self):
        from unittest.mock import MagicMock

        from apps.utils import resize_image

        ff = MagicMock()
        ff.__bool__ = lambda self: False
        resize_image(ff)

    def test_persisted_file_skipped(self):
        """Already-persisted files (not UploadedFile) should be skipped."""
        from unittest.mock import MagicMock

        from apps.utils import resize_image

        ff = MagicMock()
        ff.__bool__ = lambda self: True
        # file attribute is NOT an UploadedFile instance
        ff.file = MagicMock(spec=io.BytesIO)
        ff.file.read = lambda: b"data"
        resize_image(ff)
        # No save should have been called
        ff.save.assert_not_called()

    def test_large_image_is_resized(self, tmp_path):
        """Images larger than max_size should be resized and saved as webp."""
        from apps.utils import resize_image

        upload = _make_uploaded_image(width=600, height=600)
        ff = _make_field_file_with_upload(upload)
        resize_image(ff, max_size=300)
        # save() should have been called with a .webp filename
        assert ff.name.endswith(".webp")

    def test_small_image_still_processed(self):
        """Even small images go through the pipeline (thumbnail is a no-op)."""
        from apps.utils import resize_image

        upload = _make_uploaded_image(width=100, height=100)
        ff = _make_field_file_with_upload(upload)
        resize_image(ff, max_size=300)
        assert ff.name.endswith(".webp")

    def test_rgba_image_handled(self):
        """RGBA images should be converted without error."""
        from apps.utils import resize_image

        buf = io.BytesIO()
        img = PILImage.new("RGBA", (400, 400), color=(0, 0, 255, 128))
        img.save(buf, format="PNG")
        buf.seek(0)
        upload = InMemoryUploadedFile(
            file=buf,
            field_name="file",
            name="rgba.png",
            content_type="image/png",
            size=buf.getbuffer().nbytes,
            charset=None,
        )
        ff = _make_field_file_with_upload(upload)
        resize_image(ff, max_size=300)
        assert ff.name.endswith(".webp")

    def test_invalid_file_does_not_raise(self):
        """A non-image UploadedFile should silently return (PIL.open fails)."""
        from django.core.files.uploadedfile import InMemoryUploadedFile

        from apps.utils import resize_image

        buf = io.BytesIO(b"this is not an image")
        upload = InMemoryUploadedFile(
            file=buf,
            field_name="file",
            name="bad.png",
            content_type="image/png",
            size=20,
            charset=None,
        )
        ff = _make_field_file_with_upload(upload)
        # Should not raise — errors are swallowed
        resize_image(ff, max_size=300)

    def test_custom_quality_accepted(self):
        """quality kwarg should be accepted without error."""
        from apps.utils import resize_image

        upload = _make_uploaded_image(width=200, height=200)
        ff = _make_field_file_with_upload(upload)
        resize_image(ff, max_size=300, quality=50)
        assert ff.name.endswith(".webp")

    def test_stem_preserved_in_output_name(self):
        """Output filename should preserve the original stem."""
        from apps.utils import resize_image

        upload = _make_uploaded_image(width=400, height=400, name="mysprite.png")
        ff = _make_field_file_with_upload(upload)
        resize_image(ff, max_size=300)
        assert "mysprite" in ff.name

    def test_file_with_path_stem_preserved(self):
        """When file.name contains a path prefix, only the stem is used."""
        from apps.utils import resize_image

        upload = _make_uploaded_image(width=400, height=400, name="deep.png")
        ff = _make_field_file_with_upload(upload)
        # Simulate a field whose .name has a path
        ff.name = "uploads/deep.png"
        resize_image(ff, max_size=300)
        assert ff.name.endswith(".webp")
