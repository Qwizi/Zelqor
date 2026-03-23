import uuid
from datetime import datetime
from decimal import Decimal
from ninja import Schema
from pydantic import Field


# --- Embedded user schema (lightweight) ---

class ClanUserSchema(Schema):
    id: uuid.UUID
    username: str
    elo_rating: int

    class Config:
        from_attributes = True


# --- Input schemas ---

class ClanCreateSchema(Schema):
    name: str = Field(min_length=3, max_length=32)
    tag: str = Field(min_length=2, max_length=5)
    description: str = Field(default='', max_length=500)
    color: str = Field(default='#FFFFFF', max_length=7)
    is_public: bool = True


class ClanUpdateSchema(Schema):
    name: str | None = Field(default=None, min_length=3, max_length=32)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, max_length=7)
    is_recruiting: bool | None = None
    is_public: bool | None = None
    tax_percent: Decimal | None = Field(default=None, ge=0, le=50)


class DonateSchema(Schema):
    amount: int = Field(ge=1)


class WithdrawSchema(Schema):
    amount: int = Field(ge=1)
    reason: str = Field(default='', max_length=200)


class DeclareWarSchema(Schema):
    players_per_side: int = Field(default=3, ge=1, le=5)
    wager_gold: int = Field(default=0, ge=0)


class JoinRequestSchema(Schema):
    message: str = Field(default='', max_length=200)


class ClanChatCreateSchema(Schema):
    content: str = Field(min_length=1, max_length=500)


# --- Output schemas ---

class ClanOutSchema(Schema):
    id: uuid.UUID
    name: str
    tag: str
    description: str
    badge: str | None = None
    color: str
    leader: ClanUserSchema
    level: int
    experience: int
    elo_rating: int
    member_count: int
    max_members: int
    is_recruiting: bool
    is_public: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_badge(obj):
        if obj.badge:
            return obj.badge.url
        return None


class ClanMembershipOutSchema(Schema):
    id: uuid.UUID
    user: ClanUserSchema
    role: str
    joined_at: datetime
    contributions_gold: int

    class Config:
        from_attributes = True


class ClanDetailSchema(Schema):
    id: uuid.UUID
    name: str
    tag: str
    description: str
    badge: str | None = None
    color: str
    leader: ClanUserSchema
    level: int
    experience: int
    elo_rating: int
    member_count: int
    max_members: int
    is_recruiting: bool
    is_public: bool
    treasury_gold: int
    tax_percent: Decimal
    created_at: datetime
    my_membership: ClanMembershipOutSchema | None = None

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_badge(obj):
        if obj.badge:
            return obj.badge.url
        return None


class ClanInvitationOutSchema(Schema):
    id: uuid.UUID
    clan: ClanOutSchema
    invited_user: ClanUserSchema
    invited_by: ClanUserSchema
    status: str
    created_at: datetime
    expires_at: datetime

    class Config:
        from_attributes = True


class ClanJoinRequestOutSchema(Schema):
    id: uuid.UUID
    clan: ClanOutSchema
    user: ClanUserSchema
    message: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ClanWarOutSchema(Schema):
    id: uuid.UUID
    challenger: ClanOutSchema
    defender: ClanOutSchema
    status: str
    winner_id: uuid.UUID | None = None
    challenger_elo_change: int
    defender_elo_change: int
    players_per_side: int
    wager_gold: int
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None

    class Config:
        from_attributes = True


class ClanWarParticipantOutSchema(Schema):
    id: uuid.UUID
    user: ClanUserSchema
    clan_id: uuid.UUID

    class Config:
        from_attributes = True


class ClanActivityLogOutSchema(Schema):
    id: uuid.UUID
    actor: ClanUserSchema | None
    action: str
    detail: dict
    created_at: datetime

    class Config:
        from_attributes = True


class ClanChatMessageOutSchema(Schema):
    id: uuid.UUID
    user: ClanUserSchema
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ClanLeaderboardEntrySchema(Schema):
    id: uuid.UUID
    name: str
    tag: str
    badge: str | None = None
    color: str
    level: int
    elo_rating: int
    member_count: int

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_badge(obj):
        if obj.badge:
            return obj.badge.url
        return None
