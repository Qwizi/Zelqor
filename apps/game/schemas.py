import uuid
from datetime import datetime

from ninja import Schema


class PlayerResultOutSchema(Schema):
    user_id: uuid.UUID
    username: str
    is_banned: bool = False
    placement: int
    regions_conquered: int
    units_produced: int
    units_lost: int
    buildings_built: int
    elo_change: int

    @staticmethod
    def resolve_username(obj):
        return obj.user.username

    @staticmethod
    def resolve_is_banned(obj):
        return obj.user.is_banned

    class Config:
        from_attributes = True


class MatchResultOutSchema(Schema):
    id: uuid.UUID
    match_id: uuid.UUID
    duration_seconds: int
    total_ticks: int
    player_results: list[PlayerResultOutSchema] = []

    class Config:
        from_attributes = True


class SnapshotTickSchema(Schema):
    tick: int
    created_at: datetime

    class Config:
        from_attributes = True


class SnapshotDetailSchema(Schema):
    tick: int
    state_data: dict
    created_at: datetime

    class Config:
        from_attributes = True


# --- Share link schemas ---


class CreateShareSchema(Schema):
    resource_type: str
    resource_id: str  # UUID as string


class ShareLinkOutSchema(Schema):
    token: str
    resource_type: str
    resource_id: str


class SharedMatchPlayerSchema(Schema):
    id: str
    user_id: str
    username: str
    is_banned: bool = False
    color: str
    is_alive: bool
    joined_at: datetime


class SharedPlayerResultSchema(Schema):
    user_id: str
    username: str
    is_banned: bool = False
    placement: int
    regions_conquered: int
    units_produced: int
    units_lost: int
    buildings_built: int
    elo_change: int


class SharedMatchResultSchema(Schema):
    id: str
    match_id: str
    duration_seconds: int
    total_ticks: int
    player_results: list[SharedPlayerResultSchema] = []


class SharedMatchSchema(Schema):
    id: str
    status: str
    max_players: int
    winner_id: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    players: list[SharedMatchPlayerSchema] = []


class SharedResourceSchema(Schema):
    resource_type: str
    match: SharedMatchSchema
    result: SharedMatchResultSchema | None
    snapshot_ticks: list[int] = []


class SharedSnapshotSchema(Schema):
    tick: int
    state_data: dict
