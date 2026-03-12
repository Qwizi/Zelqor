from django.urls import path

from apps.game.consumers import GameConsumer
from apps.matchmaking.consumers import MatchmakingConsumer

websocket_urlpatterns = [
    path("ws/matchmaking/", MatchmakingConsumer.as_asgi()),
    path("ws/matchmaking/<str:game_mode>/", MatchmakingConsumer.as_asgi()),
    path("ws/game/<str:match_id>/", GameConsumer.as_asgi()),
]
