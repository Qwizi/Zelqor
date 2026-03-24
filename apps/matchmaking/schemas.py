import uuid
from datetime import datetime
from typing import Literal

from ninja import Schema


class MatchPlayerOutSchema(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    username: str
    is_banned: bool = False
    color: str
    is_alive: bool
    capital_region_id: uuid.UUID | None = None
    joined_at: datetime

    @staticmethod
    def resolve_username(obj):
        return obj.user.username

    @staticmethod
    def resolve_is_banned(obj):
        return obj.user.is_banned

    class Config:
        from_attributes = True


class MatchOutSchema(Schema):
    id: uuid.UUID
    status: str
    max_players: int
    game_mode_id: uuid.UUID | None = None
    map_config_id: uuid.UUID | None = None
    winner_id: uuid.UUID | None = None
    players: list[MatchPlayerOutSchema] = []
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class MatchQueueOutSchema(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    game_mode_id: uuid.UUID | None = None
    joined_at: datetime

    class Config:
        from_attributes = True


# --- Matchmaking status endpoint schemas ---


class MatchmakingStatusInMatchSchema(Schema):
    state: Literal["in_match"] = "in_match"
    match_id: str


class LobbyPlayerStatusSchema(Schema):
    user_id: uuid.UUID
    username: str
    is_ready: bool
    is_bot: bool

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_username(obj):
        return obj.user.username

    @staticmethod
    def resolve_user_id(obj):
        return obj.user_id


class MatchmakingStatusInLobbySchema(Schema):
    state: Literal["in_lobby"] = "in_lobby"
    lobby_id: str
    game_mode_slug: str | None = None
    players: list[LobbyPlayerStatusSchema] = []
    max_players: int


class MatchmakingStatusInQueueSchema(Schema):
    state: Literal["in_queue"] = "in_queue"
    game_mode_slug: str | None = None
    joined_at: datetime


class MatchmakingStatusIdleSchema(Schema):
    state: Literal["idle"] = "idle"


MatchmakingStatusSchema = (
    MatchmakingStatusInMatchSchema
    | MatchmakingStatusInLobbySchema
    | MatchmakingStatusInQueueSchema
    | MatchmakingStatusIdleSchema
)
