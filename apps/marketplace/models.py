import uuid
from django.conf import settings
from django.db import models


class MarketListing(models.Model):
    """A buy or sell order on the marketplace."""

    class ListingType(models.TextChoices):
        SELL = 'sell', 'Sell Order'
        BUY = 'buy', 'Buy Order'

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        FULFILLED = 'fulfilled', 'Fulfilled'
        CANCELLED = 'cancelled', 'Cancelled'
        EXPIRED = 'expired', 'Expired'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='market_listings',
    )
    item = models.ForeignKey(
        'inventory.Item', on_delete=models.CASCADE,
        related_name='market_listings',
    )
    listing_type = models.CharField(max_length=10, choices=ListingType.choices)
    quantity = models.PositiveIntegerField(default=1)
    price_per_unit = models.PositiveIntegerField(help_text='Gold per unit')
    quantity_remaining = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    is_bot_listing = models.BooleanField(default=False, help_text='Created by bot seeder')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['item', 'listing_type', 'status']),
            models.Index(fields=['status', 'expires_at']),
        ]

    def __str__(self):
        return f'{self.get_listing_type_display()}: {self.item.name} x{self.quantity} @ {self.price_per_unit}g'

    @property
    def total_price(self):
        return self.price_per_unit * self.quantity


class MarketTransaction(models.Model):
    """Record of a completed marketplace trade."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    listing = models.ForeignKey(MarketListing, on_delete=models.CASCADE, related_name='transactions')
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='market_purchases',
    )
    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='market_sales',
    )
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE, related_name='transactions')
    quantity = models.PositiveIntegerField()
    price_per_unit = models.PositiveIntegerField()
    total_price = models.PositiveIntegerField()
    fee = models.PositiveIntegerField(default=0, help_text='Transaction fee (gold sink)')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.buyer.username} bought {self.item.name} x{self.quantity} from {self.seller.username}'


class MarketConfig(models.Model):
    """Singleton config for marketplace settings."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction_fee_percent = models.FloatField(default=5.0, help_text='Fee % taken from seller on sale')
    listing_duration_hours = models.PositiveIntegerField(default=72, help_text='Default listing duration')
    max_active_listings_per_user = models.PositiveIntegerField(default=20)
    bot_restock_interval_minutes = models.PositiveIntegerField(default=60, help_text='How often bot restocks')
    bot_price_variance_percent = models.FloatField(default=15.0, help_text='Bot price random variance %')

    class Meta:
        verbose_name = 'marketplace config'
        verbose_name_plural = 'marketplace config'

    def __str__(self):
        return 'Marketplace Config'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk='00000000-0000-0000-0000-000000000001')
        return obj

    def save(self, *args, **kwargs):
        self.pk = '00000000-0000-0000-0000-000000000001'
        super().save(*args, **kwargs)
