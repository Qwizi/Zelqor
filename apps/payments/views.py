import logging

from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated

from apps.accounts.auth import ActiveUserJWTAuth
from apps.game_config.decorators import require_module_controller
from apps.pagination import paginate_qs
from apps.payments.models import GemPackage, GemTransaction, PurchaseOrder, ShopItem
from apps.payments.schemas import (
    BuyShopItemInSchema,
    BuyShopItemOutSchema,
    CreateCheckoutInSchema,
    CreateCheckoutOutSchema,
    GemPackageOutSchema,
    GemTransactionOutSchema,
    GemWalletOutSchema,
    PurchaseOrderOutSchema,
    ShopItemOutSchema,
)
from apps.payments.services import (
    InsufficientGemsError,
    PurchaseLimitReachedError,
    ShopItemUnavailableError,
    buy_shop_item,
)
from apps.payments.stripe_service import create_checkout_session, get_or_create_gem_wallet

logger = logging.getLogger(__name__)


@api_controller("/payments", tags=["Payments"])
@require_module_controller("shop")
class PaymentsController:
    @route.get("/gem-wallet/", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated], response=GemWalletOutSchema)
    def get_gem_wallet(self, request):
        wallet = get_or_create_gem_wallet(request.auth)
        return wallet

    @route.get("/gem-packages/", response=list[GemPackageOutSchema])
    def list_gem_packages(self, request):
        return list(GemPackage.objects.filter(is_active=True))

    @route.post(
        "/create-checkout/",
        auth=ActiveUserJWTAuth(),
        permissions=[IsAuthenticated],
        response=CreateCheckoutOutSchema,
    )
    def create_checkout(self, request, payload: CreateCheckoutInSchema):
        package = get_object_or_404(GemPackage, slug=payload.package_slug, is_active=True)

        frontend_url = settings.CSRF_TRUSTED_ORIGINS[0] if settings.CSRF_TRUSTED_ORIGINS else "http://localhost:3000"
        success_url = f"{frontend_url}/shop?status=success"
        cancel_url = f"{frontend_url}/shop?status=cancel"

        result = create_checkout_session(
            user=request.auth,
            gem_package=package,
            idempotency_key=payload.idempotency_key,
            success_url=success_url,
            cancel_url=cancel_url,
        )
        return result

    @route.get("/purchase-history/", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def purchase_history(self, request, limit: int = 20, offset: int = 0):
        qs = PurchaseOrder.objects.filter(user=request.auth).select_related("gem_package")
        return paginate_qs(qs, limit=limit, offset=offset, schema=PurchaseOrderOutSchema)

    @route.get("/gem-transactions/", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def gem_transactions(self, request, limit: int = 50, offset: int = 0):
        qs = GemTransaction.objects.filter(user=request.auth)
        return paginate_qs(qs, limit=limit, offset=offset, schema=GemTransactionOutSchema)

    @route.get("/shop/", response=list[ShopItemOutSchema])
    def list_shop_items(self, request, category: str | None = None):
        now = timezone.now()
        qs = ShopItem.objects.filter(is_active=True).select_related("item")
        qs = qs.filter(
            _q_available_from(now),
            _q_available_until(now),
        )
        if category:
            qs = qs.filter(shop_category=category)
        return list(qs)

    @route.post("/shop/buy/", auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated], response=BuyShopItemOutSchema)
    def buy_item(self, request, payload: BuyShopItemInSchema):
        try:
            purchase = buy_shop_item(request.auth, payload.shop_item_id)
        except InsufficientGemsError as e:
            return HttpResponse(str(e), status=400)
        except ShopItemUnavailableError as e:
            return HttpResponse(str(e), status=404)
        except PurchaseLimitReachedError as e:
            return HttpResponse(str(e), status=400)

        wallet = get_or_create_gem_wallet(request.auth)
        purchase.gem_balance = wallet.gems
        return purchase


def _q_available_from(now):
    from django.db.models import Q

    return Q(available_from__lte=now) | Q(available_from__isnull=True)


def _q_available_until(now):
    from django.db.models import Q

    return Q(available_until__gte=now) | Q(available_until__isnull=True)


@api_controller("/payments", tags=["Payments Webhook"])
class PaymentsWebhookController:
    """Stripe webhook endpoint — no JWT auth, uses Stripe signature verification."""

    @route.post("/webhook/")
    def stripe_webhook(self, request: HttpRequest):
        from apps.payments.stripe_service import handle_charge_refunded, handle_checkout_completed, verify_webhook_event

        payload = request.body
        sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")

        try:
            event = verify_webhook_event(payload, sig_header)
        except Exception:
            logger.warning("Stripe webhook signature verification failed")
            return HttpResponse("Invalid signature", status=400)

        event_type = event.get("type", "")
        data_object = event.get("data", {}).get("object", {})

        if event_type == "checkout.session.completed":
            handle_checkout_completed(data_object)
        elif event_type == "charge.refunded":
            handle_charge_refunded(data_object)
        else:
            logger.debug("Unhandled Stripe event type: %s", event_type)

        return HttpResponse("ok", status=200)
