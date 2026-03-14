import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from ninja_extra import api_controller, route
from ninja_jwt.authentication import JWTAuth

from apps.inventory.models import Item, UserInventory, Wallet
from apps.inventory.views import add_item_to_inventory, get_or_create_wallet, remove_item_from_inventory
from apps.marketplace.models import MarketConfig, MarketListing, MarketTransaction
from apps.marketplace.schemas import (
    BuyFromListingInSchema,
    CreateListingInSchema,
    MarketConfigOutSchema,
    MarketListingOutSchema,
    MarketTransactionOutSchema,
)

logger = logging.getLogger(__name__)


@api_controller('/marketplace', tags=['Marketplace'])
class MarketplaceController:

    @route.get('/config/', response=MarketConfigOutSchema, auth=None)
    def get_config(self):
        """Get marketplace configuration."""
        return MarketConfig.get()

    @route.get('/listings/', response=list[MarketListingOutSchema], auth=None)
    def list_active(self, request, item_slug: str = None, listing_type: str = None):
        """List active marketplace listings, optionally filtered."""
        qs = MarketListing.objects.filter(status=MarketListing.Status.ACTIVE).select_related('seller', 'item', 'item__category')

        if item_slug:
            qs = qs.filter(item__slug=item_slug)
        if listing_type in ('sell', 'buy'):
            qs = qs.filter(listing_type=listing_type)

        # Sell orders: cheapest first. Buy orders: highest first.
        qs = qs.order_by('listing_type', 'price_per_unit')
        return list(qs[:100])

    @route.get('/my-listings/', response=list[MarketListingOutSchema], auth=JWTAuth())
    def my_listings(self, request):
        """Get current user's listings."""
        return list(
            MarketListing.objects.filter(seller=request.user)
            .exclude(status=MarketListing.Status.FULFILLED)
            .select_related('item', 'item__category', 'seller')
            .order_by('-created_at')[:50]
        )

    @route.get('/history/', response=list[MarketTransactionOutSchema], auth=JWTAuth())
    def my_history(self, request):
        """Get current user's transaction history."""
        return list(
            MarketTransaction.objects.filter(
                Q(buyer=request.user) | Q(seller=request.user)
            )
            .select_related('buyer', 'seller', 'item', 'item__category')[:50]
        )

    @route.post('/create-listing/', response=MarketListingOutSchema, auth=JWTAuth())
    def create_listing(self, request, payload: CreateListingInSchema):
        """Create a sell or buy order."""
        config = MarketConfig.get()
        active_count = MarketListing.objects.filter(
            seller=request.user, status=MarketListing.Status.ACTIVE,
        ).count()
        if active_count >= config.max_active_listings_per_user:
            return self.create_response(request, {'error': 'Too many active listings'}, status=400)

        item = Item.objects.filter(slug=payload.item_slug, is_active=True, is_tradeable=True).first()
        if not item:
            return self.create_response(request, {'error': 'Item not found or not tradeable'}, status=404)

        if payload.listing_type not in ('sell', 'buy'):
            return self.create_response(request, {'error': 'Invalid listing type'}, status=400)

        if payload.quantity < 1 or payload.price_per_unit < 1:
            return self.create_response(request, {'error': 'Quantity and price must be positive'}, status=400)

        with transaction.atomic():
            wallet = get_or_create_wallet(request.user)

            if payload.listing_type == 'sell':
                # Must have the items in inventory
                if not remove_item_from_inventory(request.user, item, payload.quantity):
                    return self.create_response(request, {'error': 'Insufficient items'}, status=400)
            else:
                # Buy order: escrow gold
                total_cost = payload.price_per_unit * payload.quantity
                if wallet.gold < total_cost:
                    return self.create_response(request, {'error': 'Insufficient gold'}, status=400)
                wallet.gold -= total_cost
                wallet.total_spent += total_cost
                wallet.save(update_fields=['gold', 'total_spent'])

            listing = MarketListing.objects.create(
                seller=request.user,
                item=item,
                listing_type=payload.listing_type,
                quantity=payload.quantity,
                quantity_remaining=payload.quantity,
                price_per_unit=payload.price_per_unit,
                expires_at=timezone.now() + timedelta(hours=config.listing_duration_hours),
            )

        # Refetch with relations
        listing = MarketListing.objects.select_related('seller', 'item', 'item__category').get(pk=listing.pk)
        return listing

    @route.post('/buy/', auth=JWTAuth())
    def buy_from_listing(self, request, payload: BuyFromListingInSchema):
        """Buy items from a sell listing."""
        config = MarketConfig.get()

        with transaction.atomic():
            listing = (
                MarketListing.objects
                .select_for_update()
                .filter(
                    id=payload.listing_id,
                    listing_type=MarketListing.ListingType.SELL,
                    status=MarketListing.Status.ACTIVE,
                )
                .select_related('seller', 'item')
                .first()
            )
            if not listing:
                return self.create_response(request, {'error': 'Listing not found or not available'}, status=404)

            if listing.seller_id == request.user.id:
                return self.create_response(request, {'error': 'Cannot buy your own listing'}, status=400)

            qty = min(payload.quantity, listing.quantity_remaining)
            if qty < 1:
                return self.create_response(request, {'error': 'No items remaining'}, status=400)

            total_price = listing.price_per_unit * qty
            fee = int(total_price * config.transaction_fee_percent / 100)
            seller_receives = total_price - fee

            buyer_wallet = get_or_create_wallet(request.user)
            if buyer_wallet.gold < total_price:
                return self.create_response(request, {'error': 'Insufficient gold'}, status=400)

            # Transfer gold
            buyer_wallet.gold -= total_price
            buyer_wallet.total_spent += total_price
            buyer_wallet.save(update_fields=['gold', 'total_spent'])

            seller_wallet = get_or_create_wallet(listing.seller)
            seller_wallet.gold += seller_receives
            seller_wallet.total_earned += seller_receives
            seller_wallet.save(update_fields=['gold', 'total_earned'])

            # Give items to buyer
            add_item_to_inventory(request.user, listing.item, qty)

            # Update listing
            listing.quantity_remaining -= qty
            if listing.quantity_remaining <= 0:
                listing.status = MarketListing.Status.FULFILLED
            listing.save(update_fields=['quantity_remaining', 'status'])

            # Record transaction
            MarketTransaction.objects.create(
                listing=listing,
                buyer=request.user,
                seller=listing.seller,
                item=listing.item,
                quantity=qty,
                price_per_unit=listing.price_per_unit,
                total_price=total_price,
                fee=fee,
            )

        return {'message': f'Bought {qty}x {listing.item.name} for {total_price} gold (fee: {fee})'}

    @route.post('/cancel/{listing_id}/', auth=JWTAuth())
    def cancel_listing(self, request, listing_id: str):
        """Cancel your own listing and return items/gold."""
        with transaction.atomic():
            listing = (
                MarketListing.objects
                .select_for_update()
                .filter(id=listing_id, seller=request.user, status=MarketListing.Status.ACTIVE)
                .select_related('item')
                .first()
            )
            if not listing:
                return self.create_response(request, {'error': 'Listing not found'}, status=404)

            listing.status = MarketListing.Status.CANCELLED
            listing.save(update_fields=['status'])

            if listing.listing_type == MarketListing.ListingType.SELL:
                # Return items
                add_item_to_inventory(request.user, listing.item, listing.quantity_remaining)
            else:
                # Return escrowed gold
                refund = listing.price_per_unit * listing.quantity_remaining
                wallet = get_or_create_wallet(request.user)
                wallet.gold += refund
                wallet.total_spent -= refund
                wallet.save(update_fields=['gold', 'total_spent'])

        return {'message': 'Listing cancelled'}
