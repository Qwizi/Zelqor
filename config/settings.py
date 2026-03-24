from pathlib import Path
from datetime import timedelta
from decouple import config, Csv

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY', default='django-insecure-dev-key-change-in-production')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1,backend', cast=Csv())
CSRF_TRUSTED_ORIGINS = config('CSRF_TRUSTED_ORIGINS', default='', cast=Csv())

DATA_UPLOAD_MAX_NUMBER_FIELDS = 5000

INSTALLED_APPS = [
    'unfold',
    'unfold.contrib.filters',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.gis',
    'corsheaders',
    # Third party
    'ninja_extra',
    'ninja_jwt',
    'django_prometheus',
    # Local apps
    'apps.accounts',
    'apps.geo',
    'apps.game_config',
    'apps.matchmaking',
    'apps.game',
    'apps.chat',
    'apps.inventory',
    'apps.marketplace',
    'apps.crafting',
    'apps.developers',
    'apps.assets',
    'apps.notifications',
    'apps.clans',
]

MIDDLEWARE = [
    'django_prometheus.middleware.PrometheusBeforeMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'apps.developers.middleware.RateLimitHeadersMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.accounts.middleware.LastActiveMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'django_prometheus.middleware.PrometheusAfterMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Database — PostgreSQL + PostGIS
DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'NAME': config('DB_NAME', default='maplord'),
        'USER': config('DB_USER', default='maplord'),
        'PASSWORD': config('DB_PASSWORD', default='maplord'),
        'HOST': config('DB_HOST', default='db'),
        'PORT': config('DB_PORT', default='5432'),
        'CONN_MAX_AGE': config('DB_CONN_MAX_AGE', default=60, cast=int),
        'CONN_HEALTH_CHECKS': True,
    }
}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'assets']

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

FIXTURE_DIRS = [BASE_DIR / 'fixtures']

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Trust X-Forwarded-Proto from reverse proxy (Caddy / Cloudflare Tunnel)
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Celery
CELERY_BROKER_URL = config('CELERY_BROKER_URL', default='redis://redis:6379/0')
CELERY_RESULT_BACKEND = config('CELERY_RESULT_BACKEND', default='redis://redis:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'
CELERY_BEAT_SCHEDULE = {
    'cleanup-stale-matches': {
        'task': 'apps.game.tasks.cleanup_stale_matches',
        'schedule': 300,  # every 5 minutes
    },
    'cleanup-stale-queue': {
        'task': 'apps.game.tasks.cleanup_stale_queue_entries',
        'schedule': 180,  # every 3 minutes
    },
    'bot-restock-marketplace': {
        'task': 'apps.marketplace.tasks.bot_restock_marketplace',
        'schedule': 3600,  # every 60 minutes
    },
    'expire-old-listings': {
        'task': 'apps.marketplace.tasks.expire_old_listings',
        'schedule': 900,  # every 15 minutes
    },
    'cleanup-stale-lobbies': {
        'task': 'apps.matchmaking.tasks.cleanup_stale_lobbies',
        'schedule': 30,  # every 30 seconds
    },
    'flush-last-active': {
        'task': 'apps.accounts.tasks.flush_last_active',
        'schedule': 300,  # every 5 minutes
    },
    'expire-clan-invitations': {
        'task': 'apps.clans.tasks.expire_clan_invitations',
        'schedule': 3600,  # every hour
    },
    'expire-pending-clan-wars': {
        'task': 'apps.clans.tasks.expire_pending_wars',
        'schedule': 3600,  # every hour
    },
}

# Redis direct connection (game state store)
REDIS_HOST = config('REDIS_HOST', default='redis')
REDIS_PORT = config('REDIS_PORT', default=6379, cast=int)
REDIS_GAME_DB = config('REDIS_GAME_DB', default=1, cast=int)

# Django cache — Redis db=2 (db=0 Celery, db=1 game state)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': f"redis://{config('REDIS_HOST', default='redis')}:{config('REDIS_PORT', default=6379, cast=int)}/2",
    }
}

# VAPID push notifications
VAPID_PUBLIC_KEY = config('VAPID_PUBLIC_KEY', default='')
VAPID_PRIVATE_KEY = config('VAPID_PRIVATE_KEY', default='')
VAPID_MAILTO = config('VAPID_MAILTO', default='mailto:admin@maplord.com')

AUTHENTICATION_BACKENDS = [
    'apps.accounts.backends.UsernameOrEmailBackend',
]

# Ninja JWT
NINJA_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=config('JWT_ACCESS_TOKEN_LIFETIME_MINUTES', default=60, cast=int)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=config('JWT_REFRESH_TOKEN_LIFETIME_DAYS', default=7, cast=int)),
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# Social Auth (Google OAuth2)
GOOGLE_CLIENT_ID = config('GOOGLE_CLIENT_ID', default='')
GOOGLE_CLIENT_SECRET = config('GOOGLE_CLIENT_SECRET', default='')

# Social Auth (Discord OAuth2)
DISCORD_CLIENT_ID = config('DISCORD_CLIENT_ID', default='')
DISCORD_CLIENT_SECRET = config('DISCORD_CLIENT_SECRET', default='')

# Steam Auth
STEAM_WEB_API_KEY = config('STEAM_WEB_API_KEY', default='')
STEAM_APP_ID = config('STEAM_APP_ID', default='480')

# CORS
# Internal API secret for Rust gateway
INTERNAL_SECRET = config('INTERNAL_SECRET', default='dev-internal-secret')


# Unfold Admin
UNFOLD = {
    "SITE_TITLE": "MapLord Admin",
    "SITE_HEADER": "MapLord",
    "SITE_SYMBOL": "map",
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": True,
    "ENVIRONMENT": "config.unfold_callbacks.environment_callback",
    "DASHBOARD_CALLBACK": "apps.dashboard.dashboard_callback",
    "STYLES": [
        lambda request: __import__("django.templatetags.static", fromlist=["static"]).static("admin/css/unfold-custom.css"),
    ],
    "COLORS": {
        "primary": {
            "50": "oklch(97.7% 0.014 308.299)",
            "100": "oklch(95.5% 0.028 308.299)",
            "200": "oklch(90.5% 0.058 308.299)",
            "300": "oklch(84.0% 0.102 308.299)",
            "400": "oklch(74.7% 0.167 308.299)",
            "500": "oklch(65.5% 0.228 303.9)",
            "600": "oklch(62.7% 0.265 303.9)",
            "700": "oklch(54.5% 0.245 303.9)",
            "800": "oklch(47.0% 0.208 303.9)",
            "900": "oklch(40.0% 0.170 303.9)",
            "950": "oklch(30.0% 0.130 303.9)",
        },
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": True,
        "navigation": [
            {
                "title": "Users",
                "separator": True,
                "items": [
                    {
                        "title": "Users",
                        "icon": "person",
                        "link": "/admin/accounts/user/",
                    },
                    {
                        "title": "Social Accounts",
                        "icon": "link",
                        "link": "/admin/accounts/socialaccount/",
                    },
                ],
            },
            {
                "title": "Game Config",
                "separator": True,
                "items": [
                    {
                        "title": "Game Settings",
                        "icon": "settings",
                        "link": "/admin/game_config/gamesettings/",
                    },
                    {
                        "title": "Game Modes",
                        "icon": "sports_esports",
                        "link": "/admin/game_config/gamemode/",
                    },
                    {
                        "title": "Building Types",
                        "icon": "domain",
                        "link": "/admin/game_config/buildingtype/",
                    },
                    {
                        "title": "Unit Types",
                        "icon": "military_tech",
                        "link": "/admin/game_config/unittype/",
                    },
                    {
                        "title": "Ability Types",
                        "icon": "bolt",
                        "link": "/admin/game_config/abilitytype/",
                    },
                    {
                        "title": "Map Configs",
                        "icon": "public",
                        "link": "/admin/game_config/mapconfig/",
                    },
                    {
                        "title": "Game Modules",
                        "icon": "extension",
                        "link": "/admin/game_config/gamemodule/",
                    },
                    {
                        "title": "System Modules",
                        "icon": "toggle_on",
                        "link": "/admin/game_config/systemmodule/",
                    },
                ],
            },
            {
                "title": "Geo",
                "separator": True,
                "items": [
                    {
                        "title": "Countries",
                        "icon": "flag",
                        "link": "/admin/geo/country/",
                    },
                    {
                        "title": "Regions",
                        "icon": "location_on",
                        "link": "/admin/geo/region/",
                    },
                ],
            },
            {
                "title": "Matchmaking",
                "separator": True,
                "items": [
                    {
                        "title": "Matches",
                        "icon": "swords",
                        "link": "/admin/matchmaking/match/",
                    },
                    {
                        "title": "Match Players",
                        "icon": "groups",
                        "link": "/admin/matchmaking/matchplayer/",
                    },
                    {
                        "title": "Match Queue",
                        "icon": "queue",
                        "link": "/admin/matchmaking/matchqueue/",
                    },
                ],
            },
            {
                "title": "Game",
                "separator": True,
                "items": [
                    {
                        "title": "Snapshots",
                        "icon": "camera",
                        "link": "/admin/game/gamestatesnapshot/",
                    },
                    {
                        "title": "Match Results",
                        "icon": "leaderboard",
                        "link": "/admin/game/matchresult/",
                    },
                    {
                        "title": "Player Results",
                        "icon": "emoji_events",
                        "link": "/admin/game/playerresult/",
                    },
                ],
            },
            {
                "title": "Chat",
                "separator": True,
                "items": [
                    {
                        "title": "Chat Messages",
                        "icon": "chat",
                        "link": "/admin/chat/chatmessage/",
                    },
                    {
                        "title": "Match Chat",
                        "icon": "forum",
                        "link": "/admin/chat/matchchatmessage/",
                    },
                ],
            },
            {
                "title": "Economy",
                "separator": True,
                "items": [
                    {
                        "title": "Item Categories",
                        "icon": "category",
                        "link": "/admin/inventory/itemcategory/",
                    },
                    {
                        "title": "Items",
                        "icon": "inventory_2",
                        "link": "/admin/inventory/item/",
                    },
                    {
                        "title": "User Inventory",
                        "icon": "backpack",
                        "link": "/admin/inventory/userinventory/",
                    },
                    {
                        "title": "Item Drops",
                        "icon": "redeem",
                        "link": "/admin/inventory/itemdrop/",
                    },
                    {
                        "title": "Wallets",
                        "icon": "account_balance_wallet",
                        "link": "/admin/inventory/wallet/",
                    },
                ],
            },
            {
                "title": "Marketplace",
                "separator": True,
                "items": [
                    {
                        "title": "Listings",
                        "icon": "sell",
                        "link": "/admin/marketplace/marketlisting/",
                    },
                    {
                        "title": "Transactions",
                        "icon": "receipt_long",
                        "link": "/admin/marketplace/markettransaction/",
                    },
                    {
                        "title": "Market Config",
                        "icon": "tune",
                        "link": "/admin/marketplace/marketconfig/",
                    },
                ],
            },
            {
                "title": "Crafting",
                "separator": True,
                "items": [
                    {
                        "title": "Recipes",
                        "icon": "auto_fix_high",
                        "link": "/admin/crafting/recipe/",
                    },
                    {
                        "title": "Crafting Log",
                        "icon": "history",
                        "link": "/admin/crafting/craftinglog/",
                    },
                ],
            },
            {
                "title": "Developers",
                "separator": True,
                "items": [
                    {
                        "title": "Apps",
                        "icon": "apps",
                        "link": "/admin/developers/developerapp/",
                    },
                    {
                        "title": "API Keys",
                        "icon": "key",
                        "link": "/admin/developers/apikey/",
                    },
                    {
                        "title": "Webhooks",
                        "icon": "webhook",
                        "link": "/admin/developers/webhook/",
                    },
                ],
            },
            {
                "title": "Assets",
                "separator": True,
                "items": [
                    {
                        "title": "Game Assets",
                        "icon": "image",
                        "link": "/admin/assets/gameasset/",
                    },
                ],
            },
        ],
    },
}

CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost,http://localhost:3002',
    cast=Csv(),
)
