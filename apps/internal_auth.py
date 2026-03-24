from django.conf import settings


def check_internal_secret(request):
    """Verify X-Internal-Secret header matches configured secret."""
    expected = getattr(settings, "INTERNAL_SECRET", "dev-internal-secret")
    actual = request.META.get("HTTP_X_INTERNAL_SECRET", "")
    return actual == expected
