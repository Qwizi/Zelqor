import uuid
from typing import Literal, Optional, List, Union
from datetime import datetime
from ninja import Schema


class MatchPlayerOutSchema(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    username: str
    is_banned: bool = False
    color: str
    is_alive: bool
    capital_region_id: Optional[uuid.UUID] = None
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
    game_mode_id: Optional[uuid.UUID] = None
    map_config_id: Optional[uuid.UUID] = None
    winner_id: Optional[uuid.UUID] = None
    players: List[MatchPlayerOutSchema] = []
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class MatchQueueOutSchema(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    game_mode_id: Optional[uuid.UUID] = None
    joined_at: datetime

    class Config:
        from_attributes = True


# --- Matchmaking status endpoint schemas ---

class MatchmakingStatusInMatchSchema(Schema):
    state: Literal['in_match'] = 'in_match'
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
    state: Literal['in_lobby'] = 'in_lobby'
    lobby_id: str
    game_mode_slug: Optional[str] = None
    players: List[LobbyPlayerStatusSchema] = []
    max_players: int


class MatchmakingStatusInQueueSchema(Schema):
    state: Literal['in_queue'] = 'in_queue'
    game_mode_slug: Optional[str] = None
    joined_at: datetime


class MatchmakingStatusIdleSchema(Schema):
    state: Literal['idle'] = 'idle'


MatchmakingStatusSchema = Union[
    MatchmakingStatusInMatchSchema,
    MatchmakingStatusInLobbySchema,
    MatchmakingStatusInQueueSchema,
    MatchmakingStatusIdleSchema,
]
