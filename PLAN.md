# Zelqor 2.0 — Plan Implementacji

## Opis projektu
Zelqor 2.0 to webowa gra strategiczna czasu rzeczywistego osadzona na prawdziwej mapie świata.
Gracze wybierają region startowy (stolica), generują jednostki co X czasu, budują budynki specjalne
i walczą o kontrolę nad terytoriami. Przegrana następuje po utracie stolicy.

## Stack technologiczny

### Backend (wzorowany na mapcident)
- **Django 6.x** + **Django Ninja Extra** + **Django Ninja JWT** (API, kontrolery, Pydantic schemas, auto OpenAPI)
- **Rust Gateway** (axum + tokio) — WebSocket: matchmaking, game loop, engine
- **Celery** + Redis (zadania poboczne: snapshoty DB, ELO, cleanup)
- **PostgreSQL 16** + PostGIS (dane gry, dane geospatialne regionów)
- **Redis** (game state store, cache, kolejka matchmakingu)
- **Django Admin** (pełna konfiguracja gry z panelu)
- **uv** (package manager — szybki, lockfile, Python 3.13)
- **python-decouple** (env variables)
- **gunicorn** (prod WSGI)
- **msgpack/rmp-serde** (serializacja stanu gry w Redis — Rust)

### Frontend (wzorowany na mapcident)
- **Next.js 16** (App Router, Server Components, standalone output)
- **React 19** + **TypeScript 5**
- **mapcn** (MapLibre GL + shadcn/ui komponenty mapowe)
- **shadcn** + **Tailwind CSS 4** (PostCSS plugin)
- **react-hook-form** + **zod** (walidacja formularzy)
- **lucide-react** (ikony)
- **sonner** (toasty)
- **pnpm** (package manager)

### Infrastruktura (wzorowane na mapcident)
- **Docker Compose** — dev: db, redis, backend, frontend
- **Docker Compose prod** — pre-built GHCR images + Caddy reverse proxy
- **Caddy** — reverse proxy (dev + prod, static/media serving)
- **GitHub Actions** — CalVer auto-tagging + Docker build (GHCR)
- Struktura flat (nie monorepo z podfolderami) — `manage.py`, `config/`, `apps/`, `frontend/` na tym samym poziomie

---

## Architektura Systemu

```
┌─────────────────┐        ┌──────────────────────┐
│   Next.js 16    │◄──────►│  Django Ninja Extra   │
│   (Frontend)    │  HTTP   │  /api/v1/...          │
│                 │        │  (Pydantic + OpenAPI)  │
│  mapcn (MapLibre)│◄──WS──►│  Rust Gateway (axum)  │
│  Game UI        │        │  /ws/game/{match_id}/  │
│  shadcn/ui      │        │  /ws/matchmaking/      │
└─────────────────┘        └──────────┬─────────────┘
       │                              │
    Caddy                  ┌──────────┼─────────────┐
  (reverse proxy)          │          │             │
                     ┌─────▼───┐ ┌────▼────┐ ┌─────▼──────┐
                     │PostgreSQL│ │  Redis  │ │   Celery   │
                     │+ PostGIS │ │(state+  │ │  (poboczne │
                     │         │ │ cache)  │ │   taski)   │
                     └─────────┘ └─────────┘ └────────────┘
```

---

## Dane Geoprzestrzenne

- Źródło: Natural Earth Data (publiczny GeoJSON) — podział na kraje
- Każdy kraj podzielony na N regionów (admin level 1 — województwa/stany/prowincje)
- Dane ładowane do PostGIS jako modele Region z polami:
  - `name`, `country`, `geometry` (MultiPolygon), `neighbors` (M2M)
- Graf sąsiedztwa regionów wyliczany automatycznie z geometrii (ST_Touches)
- Dane GeoJSON serwowane do frontendu przez API i cachowane

---

## Modele Django (główne)

### Aplikacja `accounts`
- **User** (extends AbstractUser): username, email, avatar, elo_rating
- **SocialAccount**: provider, provider_id, user (FK)

### Aplikacja `game_config` (Admin-configurable)
- **GameSettings** (singleton): max_players, tick_interval_seconds, unit_generation_rate, starting_units, match_duration_limit, capital_bonus_multiplier
- **BuildingType**: name, icon, description, cost, build_time_ticks, unlocks_unit_type (FK)
- **UnitType**: name, icon, attack, defense, speed, range, movement_type (land/sea/air), produced_by (FK to BuildingType)
- **MapConfig**: name, geojson_source, active (boolean)

### Aplikacja `matchmaking`
- **MatchQueue**: user (FK), joined_at, status (waiting/matched/cancelled)
- **Match**: id (UUID), status (waiting/in_progress/finished), players (M2M), map_config (FK), winner (FK nullable), started_at, finished_at, settings_snapshot (JSON)

### Aplikacja `game`
- **GameState**: match (OneToOne), current_tick, phase
- **PlayerState**: match (FK), user (FK), is_alive, color, capital_region (FK)
- **RegionState**: match (FK), region (FK), owner (FK to PlayerState nullable), unit_count, building (FK nullable), is_capital (bool)
- **RegionAction**: match (FK), player (FK), action_type (attack/move/build), source_region (FK), target_region (FK), units_count, tick_created, tick_resolved, status

### Aplikacja `shop` (placeholder)
- **ShopCategory**: name, order
- **ShopItem**: name, description, price, category (FK), item_type, is_active

### Aplikacja `geo`
- **Country**: name, code, geometry
- **Region**: name, country (FK), geometry (MultiPolygon), centroid (Point)
- **RegionNeighbor**: region (FK), neighbor (FK) — lub M2M through

---

## Game Loop (Real-time w WebSocket + Redis State)

Podejście: **game loop działa w Rust Gateway (tokio)**, stan gry w **Redis**, Celery do zadań pobocznych.

### Architektura real-time:
1. **Rust Gateway** (axum + tokio) — obsługuje WebSocket, game loop, engine
2. **Game loop** (`tokio::spawn`) per mecz:
   a. `loop` → `tokio::time::sleep(tick_interval)`
   b. Czyta stan gry z Redis (`game:{match_id}:*`) — pipelined
   c. Pobiera akcje graczy z Redis List (`game:{match_id}:actions` — LPOP all)
   d. Generuje jednostki w regionach gracza (rate z admina)
   e. Przetwarza akcje (ataki, ruchy, budowanie)
   f. Rozwiązuje walki (attack vs defense + losowość)
   g. Sprawdza warunek przegranej (stolica przejęta)
   h. Zapisuje nowy stan do Redis (pipeline — atomowe, dirty region optimization)
   i. **Natychmiast broadcastuje** delta stanu do graczy (DashMap channels)
3. **Akcje graczy** przychodzą przez WebSocket → RPUSH do `game:{match_id}:actions` (Redis List)
4. **Django Internal API** (`/api/internal/`) — Rust gateway calls Django for DB ops (match creation, snapshots, ELO)
5. **Stan gry w Redis** (szybko, crash-safe, skalowalnie):

### Redis Keys per mecz:
```
game:{match_id}:meta          — Hash: status, current_tick, phase, tick_interval
game:{match_id}:players       — Hash: player_id → msgpack({color, is_alive, capital_region_id, ...})
game:{match_id}:regions       — Hash: region_id → msgpack({owner_id, unit_count, building_type, is_capital, ...})
game:{match_id}:actions       — List: kolejka akcji graczy (RPUSH/LPOP)
game:{match_id}:buildings_queue — List: budynki w trakcie budowy
```
- Serializacja: **msgpack** (2-3x szybszy niż JSON, mniejszy rozmiar)
- Redis pipeline do atomowego odczytu/zapisu całego stanu w jednym roundtrip
- TTL na klucze: auto-cleanup po zakończeniu meczu

### Celery (zadania poboczne — NIE game loop):
- Matchmaking processing (znajdowanie par w kolejce)
- Snapshot stanu gry z Redis → PostgreSQL co N ticków (backup + replay)
- Post-match: aktualizacja ELO, statystyki, historia meczy
- Cleanup: usuwanie kluczy Redis zakończonych meczy

### Zalety Redis jako game state:
- **Crash recovery**: restart Gateway → game loop wznawia się z ostatniego stanu w Redis
- **Skalowalność horyzontalna**: wiele instancji Gateway może obsługiwać różne mecze, wszystkie czytają ten sam Redis
- **Niski latency**: ~0.5ms per operacja (localhost), pomijalny przy ticku co 1s
- **Atomowość**: Redis pipeline gwarantuje spójność stanu
- **Monitoring**: łatwy podgląd stanu gry przez redis-cli/RedisInsight
- **Prosty flow**: WebSocket = komunikacja, Redis = state, PostgreSQL = persistence

---

## Fazy implementacji (TODO)

### Faza 1: Fundament projektu (wzorowane na mapcident)
- **1.1** Inicjalizacja projektu (uv init, pyproject.toml, .python-version 3.13, Django project w config/)
- **1.2** Docker Compose dev (PostgreSQL+PostGIS, Redis, backend, frontend, Caddy)
- **1.3** Konfiguracja Django (settings.py z decouple, Django Ninja Extra, Channels, Celery)
- **1.4** Konfiguracja Next.js 16 (pnpm, App Router, Tailwind 4, shadcn, mapcn, Dockerfile + Dockerfile.dev)
- **1.5** Caddy config (dev + prod), .env.example, .env.prod.example, .gitignore
- **1.6** Docker Compose prod (GHCR images, Caddy, volumes)
- **1.7** GitHub Actions (CalVer tagging, Docker build backend+frontend → GHCR)

### Faza 2: Autentykacja (wzór: mapcident AuthController)
- **2.1** Model User (UUID pk, email-based login, role, elo_rating, avatar) + UserAdmin
- **2.2** JWT tokeny (django-ninja-jwt, NinjaJWTDefaultController, Bearer auth)
- **2.3** AuthController (POST /register, GET /me) + Pydantic schemas
- **2.4** Social Auth backend (django-allauth — Google, Discord, GitHub)
- **2.5** Frontend auth: Login, Register, profil (react-hook-form + zod, JWT w cookies)

### Faza 3: Dane Geoprzestrzenne
- **3.1** Modele geo (Country, Region) z PostGIS
- **3.2** Management command: import GeoJSON (Natural Earth)
- **3.3** Automatyczne wyliczanie sąsiedztwa (ST_Touches)
- **3.4** API endpoint: GET /api/v1/geo/regions/ (GeoJSON FeatureCollection)
- **3.5** Admin panel: podgląd regionów, edycja

### Faza 4: Konfiguracja gry (Admin)
- **4.1** Modele GameSettings, BuildingType, UnitType
- **4.2** Django Admin z bogatym UI (django-unfold lub grappelli)
- **4.3** API: GET /api/v1/config/ (publiczna konfiguracja gry)

### Faza 5: Matchmaking
- **5.1** WebSocket consumer: /ws/matchmaking/ (dołącz/opuść kolejkę)
- **5.2** Logika matchmakingu (Redis sorted set — ELO matching)
- **5.3** Tworzenie Match, powiadomienie graczy
- **5.4** Frontend: przycisk "Szukaj gry", animacja kolejki, redirect do meczu

### Faza 6: Mapa i Wybór Stolicy
- **6.1** Widok meczu z mapcn (MapLibre)
- **6.2** Renderowanie regionów jako warstw GeoJSON (kolorowanie)
- **6.3** Faza wyboru stolicy (klik na region → potwierdź)
- **6.4** WebSocket consumer: /ws/game/{match_id}/ (wybór stolicy, synchronizacja)
- **6.5** Timer na wybór stolicy (konfigurowalne)

### Faza 7: Game Loop Core
- **7.1** Celery Beat task: process_game_tick
- **7.2** Generowanie jednostek (rate z config, bonus stolica)
- **7.3** Akcje gracza: atak sąsiedniego regionu, przesunięcie jednostek
- **7.4** System walki (attack vs defense, losowość, teren)
- **7.5** Warunek przegranej: utrata stolicy
- **7.6** Broadcast stanu gry przez WebSocket po każdym ticku

### Faza 8: Budynki i Jednostki Specjalne
- **8.1** Akcja budowania (wybierz region → wybierz budynek → czekaj)
- **8.2** Koszary → piechota (domyślne jednostki lądowe)
- **8.3** Fabryka → czołgi (silniejsze jednostki lądowe)
- **8.4** Wieża obronna (pasywna obrona regionu)
- **8.5** Port → statki (jednostki morskie, ataki przez morze)
- **8.6** Lotniskowiec → myśliwce (jednostki powietrzne, daleki zasięg)
- **8.7** Radar (zwiększony zasięg widzenia)
- **8.8** UI budynków i produkcji na frontendzie

### Faza 9: UI Gry i Polish
- **9.1** Strona główna (szukaj gry, profil, sklep, ranking)
- **9.2** HUD meczu: minimap, zasoby, lista budynków, timer
- **9.3** Animacje ataków i ruchów na mapie
- **9.4** Panel informacyjny regionu (click → sidebar z detalami)
- **9.5** Chat w meczu (WebSocket)
- **9.6** Ekran końca meczu (wyniki, statystyki)

### Faza 10: Sklep (placeholder)
- **10.1** Modele Shop w Django Admin
- **10.2** Strona sklepu na frontendzie (grid produktów, placeholder)

### Faza 11: Profil i Ranking
- **11.1** Strona profilu (statystyki, historia meczy)
- **11.2** System ELO (aktualizacja po meczu)
- **11.3** Ranking graczy (leaderboard)

### Faza 12: DevOps i Optymalizacja
- **12.1** Cache GeoJSON (Redis)
- **12.2** Rate limiting API
- **12.3** Monitoring (Sentry lub similar)
- **12.4** Load testing WebSocket

---

## Kluczowe decyzje techniczne

### Rust Gateway + Django — architektura
**Rust Gateway** (axum + tokio) obsługuje cały real-time:
- WebSocket handling: matchmaking queue + game loop
- Game engine w Rust (pure logic, no I/O) — wydajność, bezpieczeństwo typów
- Redis state management z rmp-serde (msgpack) — pipelined, dirty region optimization
- Django jako REST API + ORM + Celery — match creation, snapshots, ELO
- Internal API (`/api/internal/`) — secured by `X-Internal-Secret` header
- Celery tylko do: snapshoty DB, post-match ELO, cleanup
- PostgreSQL jako trwały storage (historia, replay, statystyki)

### Konfigurowalność z admina
Wszystkie parametry gry w modelach z Django Admin:
- Czas ticka, rate generowania, koszty budynków, statystyki jednostek
- Liczba graczy w meczu, czas na wybór stolicy, czas trwania meczu
- Aktywne mapy, aktywne przedmioty w sklepie
- Singleton GameSettings z django-solo lub custom

### Podział regionów
- Natural Earth Admin Level 1 daje ~3,600 regionów na świecie
- Filtrowanie po aktywnym MapConfig (np. tylko Europa, cały świat)
- Sąsiedztwo wyliczane automatycznie z geometrii PostGIS

---

## Struktura katalogów (wzorowana na mapcident)

```
zelqor/
├── .env.example                  # Zmienne dev
├── .env.prod.example             # Zmienne prod
├── .python-version               # 3.13
├── .gitignore
├── .github/
│   └── workflows/
│       └── release.yml           # CalVer auto-tagging + Docker build (GHCR)
├── pyproject.toml                # uv — Django + zależności backendowe
├── uv.lock                       # uv lockfile
├── manage.py                     # Django CLI
├── Dockerfile                    # Backend prod (uv + gunicorn/daphne)
├── compose.yml                   # Dev (db, redis, backend, frontend, caddy)
├── compose.prod.yml              # Prod (GHCR images + caddy)
├── README.md
│
├── config/                       # Django config (flat, jak mapcident)
│   ├── __init__.py
│   ├── settings.py               # Pojedynczy plik, decouple do env
│   ├── urls.py                   # NinjaExtraAPI + admin
│   ├── asgi.py                   # ASGI + Channels routing
│   ├── wsgi.py
│   └── celery.py                 # Celery config
│
├── apps/
│   ├── __init__.py
│   ├── accounts/                 # User (UUID, email, role, elo_rating)
│   │   ├── models.py
│   │   ├── views.py              # AuthController (register, /me, social)
│   │   ├── schemas.py            # Pydantic schemas
│   │   ├── admin.py
│   │   └── migrations/
│   ├── geo/                      # Country, Region (PostGIS)
│   │   ├── models.py
│   │   ├── views.py              # GeoController (regions GeoJSON)
│   │   ├── schemas.py
│   │   ├── admin.py
│   │   ├── management/
│   │   │   └── commands/
│   │   │       └── import_geo.py # Import Natural Earth GeoJSON
│   │   └── migrations/
│   ├── game_config/              # GameSettings, BuildingType, UnitType
│   │   ├── models.py
│   │   ├── views.py              # ConfigController
│   │   ├── schemas.py
│   │   ├── admin.py
│   │   └── migrations/
│   ├── matchmaking/              # MatchQueue, Match
│   │   ├── models.py
│   │   ├── views.py              # MatchController (REST)
│   │   ├── consumers.py          # MatchmakingConsumer (WS)
│   │   ├── schemas.py
│   │   ├── admin.py
│   │   └── migrations/
│   ├── game/                     # GameState, game loop, combat
│   │   ├── models.py             # Match history/snapshots (PostgreSQL)
│   │   ├── views.py              # GameController (REST — historia, replay)
│   │   ├── consumers.py          # GameConsumer (WS — game loop w asyncio)
│   │   ├── engine.py             # Game loop logic (tick processing)
│   │   ├── combat.py             # System walki
│   │   ├── state.py              # Redis state manager (read/write/serialize)
│   │   ├── schemas.py
│   │   ├── admin.py
│   │   └── migrations/
│   └── shop/                     # ShopItem, ShopCategory (placeholder)
│       ├── models.py
│       ├── views.py              # ShopController
│       ├── schemas.py
│       ├── admin.py
│       └── migrations/
│
├── caddy/
│   ├── Caddyfile                 # Dev (auto_https off, reverse proxy)
│   └── Caddyfile.prod            # Prod (X-Forwarded-Proto headers)
│
├── data/
│   └── geojson/                  # Natural Earth GeoJSON files
│
├── static/                       # Django collectstatic output
├── media/                        # User uploads
│
└── frontend/
    ├── Dockerfile                # Prod (multi-stage: deps → build → runner)
    ├── Dockerfile.dev            # Dev (pnpm dev)
    ├── package.json              # Next.js 16, React 19, mapcn, shadcn
    ├── pnpm-lock.yaml
    ├── pnpm-workspace.yaml
    ├── next.config.ts            # standalone output, remote patterns
    ├── tsconfig.json             # @/* path alias
    ├── postcss.config.mjs        # Tailwind 4 PostCSS
    ├── eslint.config.mjs
    ├── components.json           # shadcn config
    ├── middleware.ts              # Auth middleware
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx              # Landing / Home
    │   ├── globals.css
    │   ├── (auth)/
    │   │   ├── login/page.tsx
    │   │   └── register/page.tsx
    │   ├── (main)/
    │   │   ├── dashboard/page.tsx    # Strona główna gry
    │   │   ├── profile/page.tsx
    │   │   ├── shop/page.tsx
    │   │   └── ranking/page.tsx
    │   └── game/
    │       └── [matchId]/page.tsx    # Widok meczu
    ├── components/
    │   ├── ui/                   # shadcn/ui
    │   ├── map/                  # mapcn + custom overlays
    │   ├── game/                 # HUD, panel regionu, budynki
    │   └── auth/                 # formularze logowania
    ├── lib/
    │   ├── api.ts                # REST API client (fetch)
    │   ├── ws.ts                 # WebSocket client
    │   └── auth.ts               # JWT token management
    ├── hooks/
    │   ├── useGameSocket.ts
    │   └── useMatchmaking.ts
    └── public/
        └── assets/               # ikony jednostek, budynków
```
