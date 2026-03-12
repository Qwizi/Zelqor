import uuid
from typing import Optional, List
from datetime import datetime
from ninja import Schema


class MatchPlayerOutSchema(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    color: str
    is_alive: bool
    capital_region_id: Optional[uuid.UUID] = None
    joined_at: datetime

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
