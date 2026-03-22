import json
import os
import uuid

import redis as redis_lib
from django.conf import settings
from django.db import IntegrityError
from django.db.models import Avg, Count, Q
from django.contrib.auth import get_user_model
from ninja.errors import HttpError
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from apps.accounts.auth import ActiveUserJWTAuth
from apps.game_config.modules import get_module_config

from apps.accounts.models import PushSubscription
from apps.accounts.schemas import LeaderboardEntrySchema, PushSubscriptionSchema, RegisterSchema, UserOutSchema
from apps.game_config.decorators import require_module
from apps.pagination import paginate_qs

User = get_user_model()


@api_controller('/auth', tags=['Auth'])
class AuthController:

    @route.post('/register', response=UserOutSchema, auth=None)
    @require_module('registration')
    def register(self, payload: RegisterSchema):
        if len(payload.username) < 3:
            raise HttpError(400, 'Nazwa uzytkownika musi miec co najmniej 3 znaki.')
        if len(payload.username) > 30:
            raise HttpError(400, 'Nazwa uzytkownika moze miec maksymalnie 30 znakow.')
        if len(payload.password) < 8:
            raise HttpError(400, 'Haslo musi miec co najmniej 8 znakow.')
        if User.objects.filter(email=payload.email).exists():
            raise HttpError(400, 'Ten adres email jest juz zajety.')
        if User.objects.filter(username=payload.username).exists():
            raise HttpError(400, 'Ta nazwa uzytkownika jest juz zajeta.')
        try:
            user = User.objects.create_user(
                email=payload.email,
                username=payload.username,
                password=payload.password,
            )
        except IntegrityError:
            raise HttpError(400, 'Nie mozna utworzyc konta. Sprobuj ponownie.')

        # Give starter items, gold, and a default deck.
        # Wrapped in try/except so registration never fails if economy data
        # has not been seeded yet.
        try:
            from apps.inventory.models import Deck, DeckItem, Item, UserInventory, Wallet

            STARTER_SLUGS = get_module_config('registration', 'starter_items', [
                'pkg-shield-1', 'bp-barracks-1', 'bp-factory-1',
                'bp-tower-1', 'bp-port-1', 'bp-carrier-1', 'bp-radar-1',
                'bp-tank-1', 'bp-fighter-1',
            ])
            starter_gold = get_module_config('registration', 'starter_gold', 100)

            Wallet.objects.get_or_create(user=user, defaults={'gold': starter_gold})

            from apps.inventory.models import ItemInstance

            instance_map = {}
            for slug in STARTER_SLUGS:
                item = Item.objects.filter(slug=slug).first()
                if not item:
                    continue
                if item.is_stackable:
                    UserInventory.objects.get_or_create(user=user, item=item, defaults={'quantity': 1})
                else:
                    inst = ItemInstance.objects.create(
                        item=item, owner=user,
                        pattern_seed=0, wear=0.0, stattrak=False, first_owner=user,
                    )
                    instance_map[slug] = inst

            deck = Deck.objects.create(user=user, name='Domyślna talia', is_default=True, is_editable=False)
            for slug in STARTER_SLUGS:
                item = Item.objects.filter(slug=slug).first()
                if item:
                    DeckItem.objects.create(deck=deck, item=item, quantity=1, instance=instance_map.get(slug))
        except Exception:
            pass

        return user

    @route.get('/me', response=UserOutSchema, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def me(self, request):
        return request.auth

    @route.post('/tutorial/complete/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def complete_tutorial(self, request):
        user = request.auth
        user.tutorial_completed = True
        user.save(update_fields=['tutorial_completed'])
        return {'ok': True}

    @route.get('/leaderboard', response=dict, auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    @require_module('leaderboard')
    def leaderboard(self, request, limit: int = 50, offset: int = 0):
        qs = (
            User.objects.filter(game_results__isnull=False, is_bot=False)
            .annotate(
                matches_played=Count('game_results', distinct=True),
                wins=Count('game_results', filter=Q(game_results__placement=1), distinct=True),
                average_placement=Avg('game_results__placement'),
            )
            .order_by('-elo_rating', '-wins', 'average_placement', 'username')
        )
        return paginate_qs(qs, limit, offset, schema=LeaderboardEntrySchema)

    @route.post('/ws-ticket/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def ws_ticket(self, request):
        ticket = str(uuid.uuid4())
        challenge = os.urandom(16).hex()
        difficulty = get_module_config('registration', 'pow_difficulty', 16)
        ws_ticket_expiry = get_module_config('registration', 'ws_ticket_expiry_seconds', 30)
        r = redis_lib.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_GAME_DB,
        )
        r.setex(
            f"ws_ticket:{ticket}",
            ws_ticket_expiry,
            json.dumps({
                'user_id': str(request.auth.id),
                'challenge': challenge,
                'difficulty': difficulty,
            }),
        )
        return {'ticket': ticket, 'challenge': challenge, 'difficulty': difficulty}

    @route.post('/push/subscribe/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def push_subscribe(self, request, payload: PushSubscriptionSchema):
        PushSubscription.objects.update_or_create(
            endpoint=payload.endpoint,
            defaults={
                'user': request.auth,
                'p256dh': payload.p256dh,
                'auth': payload.auth,
            },
        )
        return {'ok': True}

    @route.post('/push/unsubscribe/', auth=ActiveUserJWTAuth(), permissions=[IsAuthenticated])
    def push_unsubscribe(self, request, payload: PushSubscriptionSchema):
        PushSubscription.objects.filter(
            user=request.auth,
            endpoint=payload.endpoint,
        ).delete()
        return {'ok': True}

    @route.get('/push/vapid-key/', auth=None)
    def vapid_key(self, request):
        return {'vapid_public_key': settings.VAPID_PUBLIC_KEY}

    @route.get('/online-stats', auth=None)
    def online_stats(self, request):
        """Get global player activity stats: online, in_queue, in_game."""
        from datetime import timedelta

        from django.utils import timezone

        from apps.accounts.models import _get_game_redis

        threshold = timezone.now() - timedelta(minutes=2)
        online_count = User.objects.filter(last_active__gte=threshold).count()

        r = _get_game_redis()
        in_queue = 0
        in_game = 0
        cursor = 0
        while True:
            cursor, keys = r.scan(cursor, match='player:status:*', count=100)
            for key in keys:
                val = r.get(key)
                if val:
                    try:
                        import json
                        data = json.loads(val)
                        status = data.get('status', '')
                    except (json.JSONDecodeError, AttributeError):
                        status = val
                    if status == 'in_queue':
                        in_queue += 1
                    elif status == 'in_game':
                        in_game += 1
            if cursor == 0:
                break

        return {
            'online': online_count,
            'in_queue': in_queue,
            'in_game': in_game,
        }
