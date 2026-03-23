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


class SetPasswordSchema(Schema):
    new_password: str = Field(min_length=8)


class ChangePasswordSchema(Schema):
    current_password: str
    new_password: str = Field(min_length=8)


class UserOutSchema(Schema):
    id: uuid.UUID
    email: str
    username: str
    role: str
    elo_rating: int
    tutorial_completed: bool
    is_banned: bool
    date_joined: datetime
    avatar_url: str | None = None
    has_password: bool = False
    matches_played: int = 0
    wins: int = 0
    win_rate: float = 0.0
    average_placement: float = 0.0

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_avatar_url(obj):
        if obj.avatar:
            return obj.avatar.url
        social = obj.social_accounts.first()
        if social and social.avatar_url:
            return social.avatar_url
        return None

    @staticmethod
    def resolve_has_password(obj):
        return obj.has_usable_password()


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
    avatar_url: str | None = None

    class Config:
        from_attributes = True

    @model_validator(mode='after')
    def compute_derived(self) -> 'LeaderboardEntrySchema':
        if self.matches_played > 0:
            self.win_rate = self.wins / self.matches_played
        return self

    @staticmethod
    def resolve_avatar_url(obj):
        if obj.avatar:
            return obj.avatar.url
        social = obj.social_accounts.first()
        if social and social.avatar_url:
            return social.avatar_url
        return None


class FriendUserSchema(Schema):
    id: uuid.UUID
    username: str
    elo_rating: int
    is_online: bool = False
    activity_status: str = 'offline'
    activity_details: dict = {}

    class Config:
        from_attributes = True


class FriendshipOutSchema(Schema):
    id: uuid.UUID
    from_user: FriendUserSchema
    to_user: FriendUserSchema
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class FriendRequestSchema(Schema):
    username: str


class GameInviteSchema(Schema):
    game_mode: str


class DirectMessageOutSchema(Schema):
    id: uuid.UUID
    sender: FriendUserSchema
    receiver: FriendUserSchema
    content: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


class DirectMessageCreateSchema(Schema):
    content: str
