import uuid
from datetime import datetime
from ninja import Schema
from pydantic import EmailStr, Field


class RegisterSchema(Schema):
    email: EmailStr
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8)


class UserOutSchema(Schema):
    id: uuid.UUID
    email: str
    username: str
    role: str
    elo_rating: int
    tutorial_completed: bool
    date_joined: datetime

    class Config:
        from_attributes = True


class LeaderboardEntrySchema(Schema):
    id: uuid.UUID
    username: str
    elo_rating: int
    matches_played: int
    wins: int
    win_rate: float
    average_placement: float

    class Config:
        from_attributes = True
