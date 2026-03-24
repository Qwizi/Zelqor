import hashlib
import hmac
import json
import logging

import requests
from celery import shared_task

logger = logging.getLogger(__name__)


def dispatch_webhook_event(event: str, payload: dict):
    """Send event to all active webhooks subscribed to this event."""
    from apps.developers.models import Webhook

    webhooks = Webhook.objects.filter(
        is_active=True,
        events__contains=[event],
    )
    for webhook in webhooks:
        deliver_webhook.delay(str(webhook.id), event, payload)


@shared_task(bind=True, max_retries=5)
def deliver_webhook(self, webhook_id: str, event: str, payload: dict):
    """Deliver a webhook event to the registered URL."""
    from apps.developers.models import Webhook, WebhookDelivery

    try:
        webhook = Webhook.objects.get(id=webhook_id, is_active=True)
    except Webhook.DoesNotExist:
        logger.warning(f"Webhook {webhook_id} not found or inactive")
        return

    # Sign payload
    body = json.dumps(payload, default=str)
    signature = hmac.new(
        webhook.secret.encode(),
        body.encode(),
        hashlib.sha256,
    ).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-MapLord-Signature": f"sha256={signature}",
        "X-MapLord-Event": event,
    }

    response_status = None
    response_body = ""
    success = False

    try:
        response = requests.post(
            webhook.url,
            data=body,
            headers=headers,
            timeout=10,
        )
        response_status = response.status_code
        response_body = response.text[:1024]
        success = 200 <= response.status_code < 300

    except requests.RequestException as exc:
        response_body = str(exc)[:1024]
        logger.error(f"Webhook delivery failed for {webhook_id}: {exc}")

    # Log delivery
    WebhookDelivery.objects.create(
        webhook=webhook,
        event=event,
        payload=payload,
        response_status=response_status,
        response_body=response_body,
        success=success,
    )

    if success:
        if webhook.failure_count > 0:
            webhook.failure_count = 0
            webhook.save(update_fields=["failure_count"])
    else:
        webhook.failure_count += 1
        if webhook.failure_count >= webhook.max_failures:
            webhook.is_active = False
            logger.warning(f"Webhook {webhook_id} deactivated after {webhook.max_failures} failures")
        webhook.save(update_fields=["failure_count", "is_active"])

        # Retry with exponential backoff
        countdown = 60 * (2**self.request.retries)
        try:
            self.retry(countdown=countdown)
        except self.MaxRetriesExceededError:
            logger.error(f"Webhook {webhook_id} max retries exceeded for event {event}")
