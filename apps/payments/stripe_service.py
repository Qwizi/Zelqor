import logging

import stripe
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.payments.models import GemTransaction, GemWallet, PurchaseOrder

logger = logging.getLogger(__name__)


def _get_stripe():
    """Configure and return stripe module. Raises if key not set."""
    if not settings.STRIPE_SECRET_KEY:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def get_or_create_gem_wallet(user) -> GemWallet:
    wallet, _ = GemWallet.objects.get_or_create(user=user)
    return wallet


def create_checkout_session(user, gem_package, idempotency_key: str, success_url: str, cancel_url: str) -> dict:
    """Create a Stripe Checkout session and PurchaseOrder. Returns {session_url, order_id}."""
    s = _get_stripe()

    order = PurchaseOrder.objects.create(
        user=user,
        gem_package=gem_package,
        price_cents=gem_package.price_cents,
        currency=gem_package.currency,
        idempotency_key=idempotency_key,
        stripe_checkout_session_id="pending",  # placeholder, updated below
    )

    product_name = f"{gem_package.name} — {gem_package.total_gems} Gems"

    session = s.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": gem_package.currency,
                    "unit_amount": gem_package.price_cents,
                    "product_data": {"name": product_name},
                },
                "quantity": 1,
            }
        ],
        metadata={"order_id": str(order.id), "user_id": str(user.id)},
        client_reference_id=str(order.id),
        success_url=success_url,
        cancel_url=cancel_url,
    )

    order.stripe_checkout_session_id = session.id
    order.save(update_fields=["stripe_checkout_session_id"])

    return {"session_url": session.url, "order_id": str(order.id)}


def handle_checkout_completed(session) -> bool:
    """Process a successful Stripe Checkout. Returns True if gems were credited."""
    order_id = session.get("client_reference_id")
    if not order_id:
        logger.warning("Checkout completed webhook missing client_reference_id")
        return False

    with transaction.atomic():
        try:
            order = PurchaseOrder.objects.select_for_update().get(id=order_id)
        except PurchaseOrder.DoesNotExist:
            logger.error("PurchaseOrder %s not found for webhook", order_id)
            return False

        if order.status != PurchaseOrder.Status.PENDING:
            logger.info("Order %s already processed (status=%s), skipping", order_id, order.status)
            return False

        payment_intent_id = session.get("payment_intent", "")
        gems_to_credit = order.gem_package.total_gems

        wallet = get_or_create_gem_wallet(order.user)
        wallet.gems += gems_to_credit
        wallet.total_purchased += gems_to_credit
        wallet.save(update_fields=["gems", "total_purchased", "updated_at"])

        order.status = PurchaseOrder.Status.COMPLETED
        order.gems_credited = gems_to_credit
        order.stripe_payment_intent_id = payment_intent_id
        order.completed_at = timezone.now()
        order.save(update_fields=["status", "gems_credited", "stripe_payment_intent_id", "completed_at"])

        GemTransaction.objects.create(
            user=order.user,
            amount=gems_to_credit,
            reason=GemTransaction.Reason.PURCHASE,
            reference_id=str(order.id),
            balance_after=wallet.gems,
            note=f"Purchased {order.gem_package.name}",
        )

    logger.info("Credited %d gems to user %s (order %s)", gems_to_credit, order.user.username, order_id)
    return True


def handle_charge_refunded(charge) -> bool:
    """Process a Stripe charge refund. Returns True if gems were debited."""
    payment_intent_id = charge.get("payment_intent", "")
    if not payment_intent_id:
        logger.warning("Charge refunded webhook missing payment_intent")
        return False

    with transaction.atomic():
        try:
            order = PurchaseOrder.objects.select_for_update().get(stripe_payment_intent_id=payment_intent_id)
        except PurchaseOrder.DoesNotExist:
            logger.error("No PurchaseOrder found for payment_intent %s", payment_intent_id)
            return False

        if order.status == PurchaseOrder.Status.REFUNDED:
            logger.info("Order %s already refunded, skipping", order.id)
            return False

        gems_to_debit = order.gems_credited

        wallet = get_or_create_gem_wallet(order.user)
        wallet.gems = max(0, wallet.gems - gems_to_debit)
        wallet.save(update_fields=["gems", "updated_at"])

        order.status = PurchaseOrder.Status.REFUNDED
        order.refunded_at = timezone.now()
        order.save(update_fields=["status", "refunded_at"])

        GemTransaction.objects.create(
            user=order.user,
            amount=-gems_to_debit,
            reason=GemTransaction.Reason.REFUND,
            reference_id=str(order.id),
            balance_after=wallet.gems,
            note=f"Refund for {order.gem_package.name}",
        )

    logger.info("Refunded %d gems from user %s (order %s)", gems_to_debit, order.user.username, order.id)
    return True


def verify_webhook_event(payload: bytes, sig_header: str):
    """Verify Stripe webhook signature. Returns the event or raises ValueError."""
    s = _get_stripe()
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is not configured")
    return s.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
