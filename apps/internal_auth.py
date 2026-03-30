import hashlib
import hmac
import time

from django.conf import settings


def check_internal_secret(request):
    """Verify internal request authenticity.

    Supports two modes:
    1. HMAC signature (preferred): X-Internal-Signature header with
       format ``ts=<unix>,sig=<hex_hmac>``.
    2. Legacy plain secret: X-Internal-Secret header (for backward compat).

    For HMAC, both INTERNAL_SECRET and INTERNAL_SECRET_PREV are accepted
    to allow zero-downtime secret rotation.
    """
    # Try HMAC first
    sig_header = request.META.get("HTTP_X_INTERNAL_SIGNATURE", "")
    if sig_header:
        return _verify_hmac(request, sig_header)

    # Fallback to legacy plain secret
    expected = getattr(settings, "INTERNAL_SECRET", "dev-internal-secret")
    actual = request.META.get("HTTP_X_INTERNAL_SECRET", "")
    return hmac.compare_digest(actual, expected)


def _verify_hmac(request, sig_header):
    """Verify HMAC-SHA256 signature.

    Header format: ``ts=1234567890,sig=abcdef0123456789...``
    Signed message: ``{timestamp}.{method}.{path}.{body_sha256}``
    """
    # Parse header
    parts = {}
    for part in sig_header.split(","):
        if "=" in part:
            key, _, value = part.partition("=")
            parts[key.strip()] = value.strip()

    ts_str = parts.get("ts", "")
    sig_hex = parts.get("sig", "")
    if not ts_str or not sig_hex:
        return False

    # Reject if timestamp drift > 30 seconds
    try:
        ts = int(ts_str)
    except ValueError:
        return False

    if abs(time.time() - ts) > 30:
        return False

    # Build signed message (use full path including query string to match gateway signing)
    method = request.method
    path = request.get_full_path()
    body = request.body or b""
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"{ts}.{method}.{path}.{body_hash}"

    # Check against current and previous secrets
    secrets = [getattr(settings, "INTERNAL_SECRET", "dev-internal-secret")]
    prev = getattr(settings, "INTERNAL_SECRET_PREV", "")
    if prev:
        secrets.append(prev)

    for secret in secrets:
        expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(sig_hex, expected):
            return True

    return False
