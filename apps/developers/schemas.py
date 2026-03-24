import contextlib
import uuid
from datetime import datetime

from ninja import Schema
from pydantic import model_validator

# === Developer App Schemas ===


class DeveloperAppCreateSchema(Schema):
    name: str
    description: str = ""


class DeveloperAppUpdateSchema(Schema):
    name: str | None = None
    description: str | None = None


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
    scopes: list[str]
    rate_limit: int = 1000


class APIKeyOutSchema(Schema):
    id: uuid.UUID
    prefix: str
    scopes: list[str]
    rate_limit: int
    is_active: bool
    last_used: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class APIKeyCreatedSchema(APIKeyOutSchema):
    """Returned only on creation — includes the full key (shown once)."""

    key: str


# === Webhook Schemas ===


class WebhookCreateSchema(Schema):
    url: str
    events: list[str]


class WebhookUpdateSchema(Schema):
    url: str | None = None
    events: list[str] | None = None
    is_active: bool | None = None


class WebhookOutSchema(Schema):
    id: uuid.UUID
    url: str
    secret: str
    events: list[str]
    is_active: bool
    failure_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class WebhookDeliveryOutSchema(Schema):
    id: uuid.UUID
    event: str
    payload: dict
    response_status: int | None = None
    success: bool
    created_at: datetime

    class Config:
        from_attributes = True


class WebhookTestSchema(Schema):
    success: bool
    status_code: int | None = None
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
    avatar: str | None = None

    class Config:
        from_attributes = True

    @model_validator(mode="before")
    @classmethod
    def _map_from_user(cls, data):
        # When populated from a Django User ORM instance, map id -> user_id
        # and resolve the avatar ImageField to a URL string.
        if hasattr(data, "id"):
            avatar_field = getattr(data, "avatar", None)
            avatar_url: str | None = None
            if avatar_field:
                with contextlib.suppress(Exception):
                    avatar_url = str(avatar_field.url)
            return {
                "user_id": data.id,
                "username": data.username,
                "elo_rating": data.elo_rating,
                "avatar": avatar_url,
            }
        return data


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
    players: list[PublicMatchPlayerSchema] = []
    winner_username: str | None = None
    duration_ticks: int | None = None


class PublicPlayerStatsSchema(Schema):
    user_id: uuid.UUID
    username: str
    elo_rating: int
    avatar: str | None = None
    matches_played: int
    wins: int
    win_rate: float
    avg_placement: float | None = None


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
    scopes: list[str]


class AvailableEventsSchema(Schema):
    events: list[str]


# === OAuth2 Schemas ===


class OAuthAuthorizeRequestSchema(Schema):
    client_id: str
    redirect_uri: str
    scope: str  # space-separated scopes
    state: str | None = None


class OAuthTokenRequestSchema(Schema):
    grant_type: str  # 'authorization_code' or 'refresh_token'
    client_id: str
    client_secret: str
    code: str | None = None  # for authorization_code
    redirect_uri: str | None = None  # for authorization_code
    refresh_token: str | None = None  # for refresh_token


class OAuthTokenResponseSchema(Schema):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    refresh_token: str
    scope: str


class OAuthUserInfoSchema(Schema):
    id: str
    username: str
    email: str
    elo_rating: int
    avatar: str | None = None
    date_joined: str
