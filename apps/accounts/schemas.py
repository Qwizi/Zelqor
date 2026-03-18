import uuid
from datetime import datetime
from ninja import Schema
from pydantic import EmailStr, Field, model_validator


class PushSubscriptionSchema(Schema):
    endpoint: str
    p256dh: str
    auth: str


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
    is_banned: bool
    date_joined: datetime

    class Config:
        from_attributes = True


class SocialAccountOutSchema(Schema):
    id: uuid.UUID
    provider: str
    display_name: str
    email: str
    avatar_url: str
    created_at: datetime

    class Config:
        from_attributes = True


class LeaderboardEntrySchema(Schema):
    id: uuid.UUID
    username: str
    elo_rating: int
    matches_played: int
    wins: int
    win_rate: float = 0.0
    average_placement: float = 0.0
    is_banned: bool = False

    class Config:
        from_attributes = True

    @model_validator(mode='after')
    def compute_derived(self) -> 'LeaderboardEntrySchema':
        if self.matches_played > 0:
            self.win_rate = self.wins / self.matches_played
        return self
