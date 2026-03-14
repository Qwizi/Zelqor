import uuid
from typing import Optional, List
from datetime import datetime
from ninja import Schema


# === Developer App Schemas ===

class DeveloperAppCreateSchema(Schema):
    name: str
    description: str = ''


class DeveloperAppUpdateSchema(Schema):
    name: Optional[str] = None
    description: Optional[str] = None


class DeveloperAppOutSchema(Schema):
    id: uuid.UUID
    name: str
    description: str
    client_id: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class DeveloperAppCreatedSchema(DeveloperAppOutSchema):
    """Returned only on creation — includes the client_secret (shown once)."""
    client_secret: str


# === API Key Schemas ===

class APIKeyCreateSchema(Schema):
    scopes: List[str]
    rate_limit: int = 1000


class APIKeyOutSchema(Schema):
    id: uuid.UUID
    prefix: str
    scopes: List[str]
    rate_limit: int
    is_active: bool
    last_used: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class APIKeyCreatedSchema(APIKeyOutSchema):
    """Returned only on creation — includes the full key (shown once)."""
    key: str


# === Webhook Schemas ===

class WebhookCreateSchema(Schema):
    url: str
    events: List[str]


class WebhookUpdateSchema(Schema):
    url: Optional[str] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None


class WebhookOutSchema(Schema):
    id: uuid.UUID
    url: str
    secret: str
    events: List[str]
    is_active: bool
    failure_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class WebhookDeliveryOutSchema(Schema):
    id: uuid.UUID
    event: str
    payload: dict
    response_status: Optional[int] = None
    success: bool
    created_at: datetime

    class Config:
        from_attributes = True


class WebhookTestSchema(Schema):
    success: bool
    status_code: Optional[int] = None
    message: str


# === Public API Schemas ===

class PaginatedSchema(Schema):
    items: list
    total: int
    page: int
    per_page: int


class PublicLeaderboardEntrySchema(Schema):
    user_id: uuid.UUID
    username: str
    elo_rating: int
    avatar: Optional[str] = None


class PublicMatchPlayerSchema(Schema):
    user_id: uuid.UUID
    username: str
    color: str
    is_alive: bool


class PublicMatchOutSchema(Schema):
    id: uuid.UUID
    status: str
    max_players: int
    created_at: datetime

    class Config:
        from_attributes = True


class PublicMatchDetailSchema(PublicMatchOutSchema):
    players: List[PublicMatchPlayerSchema] = []
    winner_username: Optional[str] = None
    duration_ticks: Optional[int] = None


class PublicPlayerStatsSchema(Schema):
    user_id: uuid.UUID
    username: str
    elo_rating: int
    avatar: Optional[str] = None
    matches_played: int
    wins: int
    win_rate: float
    avg_placement: Optional[float] = None


class PublicConfigOutSchema(Schema):
    """Wraps the existing game config response for public API."""
    pass  # Reuses existing game_config schema at the controller level


class UsageStatsSchema(Schema):
    app_id: uuid.UUID
    total_api_calls: int
    active_keys: int
    total_webhooks: int
    active_webhooks: int
    total_deliveries: int
    successful_deliveries: int
    failed_deliveries: int


# === Scope / Event Listing ===

class AvailableScopesSchema(Schema):
    scopes: List[str]


class AvailableEventsSchema(Schema):
    events: List[str]


# === OAuth2 Schemas ===

class OAuthAuthorizeRequestSchema(Schema):
    client_id: str
    redirect_uri: str
    scope: str  # space-separated scopes
    state: Optional[str] = None


class OAuthTokenRequestSchema(Schema):
    grant_type: str  # 'authorization_code' or 'refresh_token'
    client_id: str
    client_secret: str
    code: Optional[str] = None          # for authorization_code
    redirect_uri: Optional[str] = None  # for authorization_code
    refresh_token: Optional[str] = None # for refresh_token


class OAuthTokenResponseSchema(Schema):
    access_token: str
    token_type: str = 'Bearer'
    expires_in: int
    refresh_token: str
    scope: str


class OAuthUserInfoSchema(Schema):
    id: str
    username: str
    email: str
    elo_rating: int
    avatar: Optional[str] = None
    date_joined: str
