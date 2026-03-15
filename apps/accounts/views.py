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

from apps.accounts.schemas import LeaderboardEntrySchema, RegisterSchema, UserOutSchema
from apps.pagination import paginate_qs

User = get_user_model()


@api_controller('/auth', tags=['Auth'])
class AuthController:

    @route.post('/register', response=UserOutSchema, auth=None)
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

            STARTER_SLUGS = [
                'pkg-shield-1', 'bp-barracks-1', 'bp-factory-1',
                'bp-tower-1', 'bp-port-1', 'bp-carrier-1', 'bp-radar-1',
            ]

            Wallet.objects.get_or_create(user=user, defaults={'gold': 100})

            for slug in STARTER_SLUGS:
                item = Item.objects.filter(slug=slug).first()
                if item:
                    UserInventory.objects.get_or_create(user=user, item=item, defaults={'quantity': 1})

            deck = Deck.objects.create(user=user, name='Domyślna talia', is_default=True)
            for slug in STARTER_SLUGS:
                item = Item.objects.filter(slug=slug).first()
                if item:
                    DeckItem.objects.create(deck=deck, item=item, quantity=1)
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
        difficulty = 16
        r = redis_lib.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_GAME_DB,
        )
        r.setex(
            f"ws_ticket:{ticket}",
            30,
            json.dumps({
                'user_id': str(request.auth.id),
                'challenge': challenge,
                'difficulty': difficulty,
            }),
        )
        return {'ticket': ticket, 'challenge': challenge, 'difficulty': difficulty}
