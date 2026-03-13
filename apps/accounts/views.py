from django.db.models import Avg, Count, Q
from django.contrib.auth import get_user_model
from ninja_extra import api_controller, route
from ninja_extra.permissions import IsAuthenticated
from ninja_jwt.authentication import JWTAuth

from apps.accounts.schemas import LeaderboardEntrySchema, RegisterSchema, UserOutSchema

User = get_user_model()


@api_controller('/auth', tags=['Auth'])
class AuthController:

    @route.post('/register', response=UserOutSchema, auth=None)
    def register(self, payload: RegisterSchema):
        user = User.objects.create_user(
            email=payload.email,
            username=payload.username,
            password=payload.password,
        )
        return user

    @route.get('/me', response=UserOutSchema, auth=JWTAuth(), permissions=[IsAuthenticated])
    def me(self, request):
        return request.auth

    @route.post('/tutorial/complete/', auth=JWTAuth(), permissions=[IsAuthenticated])
    def complete_tutorial(self, request):
        user = request.auth
        user.tutorial_completed = True
        user.save(update_fields=['tutorial_completed'])
        return {'ok': True}

    @route.get('/leaderboard', response=list[LeaderboardEntrySchema], auth=JWTAuth(), permissions=[IsAuthenticated])
    def leaderboard(self, request):
        rows = list(
            User.objects.filter(game_results__isnull=False, is_bot=False)
            .annotate(
                matches_played=Count('game_results', distinct=True),
                wins=Count('game_results', filter=Q(game_results__placement=1), distinct=True),
                average_placement=Avg('game_results__placement'),
            )
            .order_by('-elo_rating', '-wins', 'average_placement', 'username')[:100]
            .values(
                'id',
                'username',
                'elo_rating',
                'matches_played',
                'wins',
                'average_placement',
            )
        )
        for row in rows:
            matches_played = int(row.get('matches_played') or 0)
            wins = int(row.get('wins') or 0)
            row['win_rate'] = (wins / matches_played) if matches_played > 0 else 0.0
            row['average_placement'] = float(row.get('average_placement') or 0.0)
        return rows
