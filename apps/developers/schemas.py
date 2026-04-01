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
    grant_type: str  # 'authorization_code', 'refresh_token', 'client_credentials', or device_code URN
    client_id: str = ""
    client_secret: str = ""
    code: str | None = None  # for authorization_code
    redirect_uri: str | None = None  # for authorization_code
    refresh_token: str | None = None  # for refresh_token
    device_code: str | None = None  # for urn:ietf:params:oauth:grant-type:device_code


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


class DeviceAuthorizationRequestSchema(Schema):
    client_id: str | None = None


class DeviceAuthorizationResponseSchema(Schema):
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class DeviceAuthorizeSchema(Schema):
    user_code: str


class OAuthClientCredentialsRequestSchema(Schema):
    grant_type: str  # must be "client_credentials"
    client_id: str
    client_secret: str
    scope: str | None = None  # optional, defaults to "server:connect"


class OAuthClientCredentialsResponseSchema(Schema):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    scope: str


# === Community Server Schemas ===


class CommunityServerCreateSchema(Schema):
    name: str
    description: str = ""
    region: str
    max_players: int = 100
    is_public: bool = True
    custom_config: dict = {}
    max_concurrent_matches: int = 5
    motd: str = ""
    tags: list[str] = []
    auto_start_match: bool = True
    min_players_to_start: int = 2
    match_start_countdown_seconds: int = 30
    allow_spectators: bool = True
    max_spectators: int = 50
    allow_custom_game_modes: bool = False
    password: str = ""


class CommunityServerUpdateSchema(Schema):
    name: str | None = None
    description: str | None = None
    max_players: int | None = None
    is_public: bool | None = None
    custom_config: dict | None = None
    max_concurrent_matches: int | None = None
    motd: str | None = None
    tags: list[str] | None = None
    auto_start_match: bool | None = None
    min_players_to_start: int | None = None
    match_start_countdown_seconds: int | None = None
    allow_spectators: bool | None = None
    max_spectators: int | None = None
    allow_custom_game_modes: bool | None = None
    password: str | None = None


class CommunityServerOutSchema(Schema):
    id: str
    name: str
    description: str
    region: str
    max_players: int
    is_public: bool
    status: str
    last_heartbeat: str | None = None
    server_version: str
    is_verified: bool
    created_at: str
    max_concurrent_matches: int
    current_match_count: int
    current_player_count: int
    motd: str
    tags: list[str]
    auto_start_match: bool
    min_players_to_start: int
    match_start_countdown_seconds: int
    allow_spectators: bool
    max_spectators: int
    allow_custom_game_modes: bool
    has_password: bool
    installed_plugins: list[str] = []
    game_modes: list[str] = []

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, obj):
        plugins = []
        if hasattr(obj, "installed_plugins"):
            plugins = [sp.plugin.slug for sp in obj.installed_plugins.select_related("plugin").filter(is_enabled=True)]
        game_modes = []
        if hasattr(obj, "custom_game_modes"):
            game_modes = [gm.name for gm in obj.custom_game_modes.filter(is_active=True)]
        return cls(
            id=str(obj.id),
            name=obj.name,
            description=obj.description,
            region=obj.region,
            max_players=obj.max_players,
            is_public=obj.is_public,
            status=obj.status,
            last_heartbeat=obj.last_heartbeat.isoformat() if obj.last_heartbeat else None,
            server_version=obj.server_version,
            is_verified=obj.is_verified,
            created_at=obj.created_at.isoformat(),
            max_concurrent_matches=obj.max_concurrent_matches,
            current_match_count=obj.current_match_count,
            current_player_count=obj.current_player_count,
            motd=obj.motd,
            tags=obj.tags,
            auto_start_match=obj.auto_start_match,
            min_players_to_start=obj.min_players_to_start,
            match_start_countdown_seconds=obj.match_start_countdown_seconds,
            allow_spectators=obj.allow_spectators,
            max_spectators=obj.max_spectators,
            allow_custom_game_modes=obj.allow_custom_game_modes,
            has_password=bool(obj.password_hash),
            installed_plugins=plugins,
            game_modes=game_modes,
        )


class CommunityServerListSchema(Schema):
    id: str
    name: str
    region: str
    status: str
    max_players: int
    is_verified: bool
    current_player_count: int
    current_match_count: int
    max_concurrent_matches: int
    tags: list[str]
    has_password: bool

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            name=obj.name,
            region=obj.region,
            status=obj.status,
            max_players=obj.max_players,
            is_verified=obj.is_verified,
            current_player_count=obj.current_player_count,
            current_match_count=obj.current_match_count,
            max_concurrent_matches=obj.max_concurrent_matches,
            tags=obj.tags,
            has_password=bool(obj.password_hash),
        )


# === Plugin Schemas ===


class PluginCreateSchema(Schema):
    name: str
    slug: str
    description: str = ""
    long_description: str = ""
    hooks: list[str] = []
    category: str = "other"
    tags: list[str] = []
    homepage_url: str = ""
    source_url: str = ""
    license: str = "MIT"
    config_schema: dict = {}
    default_config: dict = {}
    min_engine_version: str = ""
    required_permissions: list[str] = []


class PluginUpdateSchema(Schema):
    description: str | None = None
    long_description: str | None = None
    hooks: list[str] | None = None
    category: str | None = None
    tags: list[str] | None = None
    homepage_url: str | None = None
    source_url: str | None = None
    license: str | None = None
    config_schema: dict | None = None
    default_config: dict | None = None
    min_engine_version: str | None = None
    required_permissions: list[str] | None = None
    is_deprecated: bool | None = None
    deprecation_message: str | None = None


class PluginOutSchema(Schema):
    id: str
    name: str
    slug: str
    description: str
    long_description: str
    version: str
    hooks: list[str]
    is_published: bool
    is_approved: bool
    download_count: int
    install_count: int
    category: str
    tags: list[str]
    homepage_url: str
    source_url: str
    license: str
    average_rating: float
    rating_count: int
    is_featured: bool
    is_deprecated: bool
    deprecation_message: str
    config_schema: dict
    default_config: dict
    min_engine_version: str
    required_permissions: list[str]
    author_name: str = ""
    created_at: str

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            name=obj.name,
            slug=obj.slug,
            description=obj.description,
            long_description=obj.long_description,
            version=obj.version,
            hooks=obj.hooks,
            is_published=obj.is_published,
            is_approved=obj.is_approved,
            download_count=obj.download_count,
            install_count=obj.install_count,
            category=obj.category,
            tags=obj.tags,
            homepage_url=obj.homepage_url,
            source_url=obj.source_url,
            license=obj.license,
            average_rating=obj.average_rating,
            rating_count=obj.rating_count,
            is_featured=obj.is_featured,
            is_deprecated=obj.is_deprecated,
            deprecation_message=obj.deprecation_message,
            config_schema=obj.config_schema,
            default_config=obj.default_config,
            min_engine_version=obj.min_engine_version,
            required_permissions=obj.required_permissions,
            author_name=obj.app.name if obj.app else "",
            created_at=obj.created_at.isoformat(),
        )


class PluginListSchema(Schema):
    id: str
    name: str
    slug: str
    version: str
    description: str
    category: str
    hooks: list[str]
    tags: list[str]
    is_approved: bool
    is_featured: bool
    download_count: int
    install_count: int
    average_rating: float
    rating_count: int
    author_name: str = ""

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            name=obj.name,
            slug=obj.slug,
            version=obj.version,
            description=obj.description,
            category=obj.category,
            hooks=obj.hooks,
            tags=obj.tags,
            is_approved=obj.is_approved,
            is_featured=obj.is_featured,
            download_count=obj.download_count,
            install_count=obj.install_count,
            average_rating=obj.average_rating,
            rating_count=obj.rating_count,
            author_name=obj.app.name if obj.app else "",
        )


class PluginVersionOutSchema(Schema):
    id: str
    version: str
    changelog: str
    min_engine_version: str
    is_yanked: bool
    created_at: str

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            version=obj.version,
            changelog=obj.changelog,
            min_engine_version=obj.min_engine_version,
            is_yanked=obj.is_yanked,
            created_at=obj.created_at.isoformat(),
        )


class PluginDependencyOutSchema(Schema):
    plugin_slug: str
    depends_on_slug: str
    version_constraint: str
    is_optional: bool

    @classmethod
    def from_orm(cls, obj):
        return cls(
            plugin_slug=obj.plugin.slug,
            depends_on_slug=obj.depends_on.slug,
            version_constraint=obj.version_constraint,
            is_optional=obj.is_optional,
        )


class PluginDependencyCreateSchema(Schema):
    depends_on_slug: str
    version_constraint: str = "*"
    is_optional: bool = False


class PluginReviewCreateSchema(Schema):
    rating: int
    title: str = ""
    body: str = ""


class PluginReviewOutSchema(Schema):
    id: str
    username: str
    rating: int
    title: str
    body: str
    created_at: str

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            username=obj.user.username,
            rating=obj.rating,
            title=obj.title,
            body=obj.body,
            created_at=obj.created_at.isoformat(),
        )


# === Server Plugin Schemas ===


class ServerPluginInstallSchema(Schema):
    plugin_slug: str
    config: dict = {}
    priority: int = 0
    version: str = ""


class ServerPluginUpdateSchema(Schema):
    config: dict | None = None
    is_enabled: bool | None = None
    priority: int | None = None


class ServerPluginOutSchema(Schema):
    id: str
    plugin_slug: str
    plugin_name: str
    plugin_version: str
    config: dict
    is_enabled: bool
    priority: int
    installed_at: str

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            plugin_slug=obj.plugin.slug,
            plugin_name=obj.plugin.name,
            plugin_version=obj.plugin_version.version if obj.plugin_version else obj.plugin.version,
            config=obj.config,
            is_enabled=obj.is_enabled,
            priority=obj.priority,
            installed_at=obj.installed_at.isoformat(),
        )


# === Custom Game Mode Schemas ===


class CustomGameModeCreateSchema(Schema):
    name: str
    slug: str
    description: str = ""
    icon: str = ""
    base_game_mode_slug: str = ""
    config_overrides: dict = {}
    is_public: bool = True


class CustomGameModeUpdateSchema(Schema):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    config_overrides: dict | None = None
    is_public: bool | None = None
    is_active: bool | None = None


class CustomGameModeOutSchema(Schema):
    id: str
    server_id: str
    creator_username: str
    name: str
    slug: str
    description: str
    icon: str
    base_game_mode: str | None
    config_overrides: dict
    required_plugins: list[str]
    is_public: bool
    is_active: bool
    play_count: int
    created_at: str

    @classmethod
    def from_orm(cls, obj):
        return cls(
            id=str(obj.id),
            server_id=str(obj.server_id),
            creator_username=obj.creator.username,
            name=obj.name,
            slug=obj.slug,
            description=obj.description,
            icon=obj.icon,
            base_game_mode=obj.base_game_mode.slug if obj.base_game_mode else None,
            config_overrides=obj.config_overrides,
            required_plugins=[p.slug for p in obj.required_plugins.all()],
            is_public=obj.is_public,
            is_active=obj.is_active,
            play_count=obj.play_count,
            created_at=obj.created_at.isoformat(),
        )


# === Available Hooks Listing ===


class AvailableHooksSchema(Schema):
    hooks: list[str]
