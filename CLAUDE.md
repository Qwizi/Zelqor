# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MapLord 2.0** is a real-time strategy web game built on a world map. Players claim territories, build armies, and compete in real-time matches. The project uses CalVer versioning (e.g., `v2026.3.23.2`).

## Commands

### Backend (Python / Django)

Uses `uv` as the package manager and Python 3.13.

```bash
uv sync                                          # Install dependencies
uv run python manage.py runserver               # Dev server (port 8000)
uv run python manage.py migrate                 # Run migrations
uv run python manage.py makemigrations          # Create migrations
uv run celery -A config worker -l info          # Celery worker
uv run celery -A config beat -l info            # Celery beat scheduler
```

### Rust Gateway

Cargo workspace under `gateway/`. Requires Rust 1.88+.

```bash
cd gateway
cargo build                    # Build all crates
cargo test                     # Run all tests
cargo run --bin maplord-gateway  # Run the gateway server (port 8080)
```

### Frontend (Next.js)

Uses `pnpm` as the package manager. Run from the `frontend/` directory.

```bash
pnpm dev      # Dev server on port 3000
pnpm build    # Production build
pnpm lint     # ESLint
```

### Docker Compose (recommended for full-stack dev)

```bash
docker compose up          # Start all services (db, redis, backend, celery, celery-beat, frontend, gateway, livekit, caddy)
docker compose up backend  # Start specific service
```

Ports in dev: Caddy on 80, backend on 8002, frontend on 3002, gateway on 8080, LiveKit on 7880, PostgreSQL on 5433, Redis on 6380.

## Architecture

### Backend (Django)

Eleven Django apps under `apps/`:

- **accounts** — User model, JWT auth, profiles
- **geo** — Geospatial data (Country, Region) using PostGIS
- **game_config** — Admin-configurable game settings (building/unit types, costs)
- **matchmaking** — Match queue and player pairing; creates Match objects; internal API for Rust gateway
- **game** — Match models, snapshots, internal API for Rust gateway; Celery tasks (ELO, cleanup)
- **chat** — Global and match-specific chat messages
- **inventory** — Player items, cosmetics, decks, gold wallet, CS2-style item instances (wear/stattrak)
- **marketplace** — Player-to-player item trading with buy/sell orders and transactions
- **crafting** — Crafting recipes (ingredients + gold cost) and crafting logs
- **developers** — Developer API access: OAuth, API keys, webhooks for third-party integrations
- **notifications** — User notifications (friend requests, match outcomes, eliminations)
- **assets** — Uploadable game assets (sprites, models, sounds, music) with categorization

Key config under `config/`:
- `asgi.py` — ASGI entry point (HTTP only, WebSocket handled by Rust gateway)
- `celery.py` — Celery app config
- `settings.py` — Main settings using `python-decouple` for env vars

### Rust Gateway (`gateway/`)

Cargo workspace with 7 crates handling all WebSocket traffic:

- **maplord-gateway** — Binary: axum WS server, JWT auth, routing, game consumer
- **maplord-engine** — Lib: pure game logic (tick processing, combat, economy, pathfinding)
- **maplord-state** — Lib: Redis state management with msgpack (rmp-serde)
- **maplord-matchmaking** — Lib: matchmaking queue logic with DashMap connection groups
- **maplord-django** — Lib: Django internal API client (reqwest)
- **maplord-ai** — Lib: bot AI strategies (BotBrain, TutorialBotBrain) implementing BotStrategy trait
- **maplord-anticheat** — Lib: cheat detection (action floods, impossible timing, fog-of-war abuse) with Redis-backed state

### Real-time Game Flow

```
Client ↔ WebSocket ↔ Rust Gateway (auth, matchmaking, game loop, engine, AI bots, anticheat)
                           ↓
                     Redis (live state, msgpack)
                           ↓
              Django HTTP Internal API (match creation, snapshots, ELO)
              Celery (async cleanup, stale match handling)
```

Game state is stored in Redis (via msgpack/rmp-serde serialization) during active matches; Celery periodically snapshots state to PostgreSQL and runs post-match ELO calculations. The Rust gateway communicates with Django via internal HTTP API (`/api/internal/`) secured by `X-Internal-Secret` header.

### Frontend

Next.js 16 App Router with TypeScript and Pixi.js 8 game rendering:

- `app/` — Pages (App Router), including `app/game/[matchId]/page.tsx` (main game page)
- `components/` — React components (ui, map, game, auth, chat)
- `lib/api.ts` — REST API client
- `lib/ws.ts` — WebSocket client
- `lib/pixiAnimations.ts` — PixiAnimationManager (trails, unit icons, impacts, nuke/bomber VFX)
- `lib/pixiAnimationPaths.ts` — Path math (curves, march, waypoints, bomber flight paths)
- `lib/particleSystem.ts` — Custom particle system with object pooling
- `lib/canvasTypes.ts` — Canvas types, constants, color helpers, effect configs
- `lib/animationConfig.ts` — Animation parameters (per-player cosmetic overrides)
- `lib/gameAssets.ts` — Unit/building asset resolution with cosmetic overrides
- `lib/gameTypes.ts` — Core game types (TroopAnimation, PlannedMove, AP costs, actions)
- `hooks/` — Custom React hooks (useEffectOverlays, useUnitPulseLabels, useBombardmentEvents, useGameAnimations)

Key libraries: **Pixi.js 8** (game map rendering), pixi-viewport (zoom/pan), MapLibre GL 5 (legacy map), shadcn/ui + Tailwind CSS 4 (UI), React Hook Form + Zod (forms), Sonner (toasts), LiveKit (voice chat), GSAP (animations), Tauri (desktop app).

#### Pixi.js Game Rendering

The game canvas (`components/map/GameCanvas.tsx`) uses layered Pixi containers: province layer, capital layer, effect layer, nuke layer, animation layer, air transit layer, planned moves layer, unit change layer. Terrain is rendered as a 27×16 chunk grid (276×308 px each) loaded as background sprites.

For PixiJS API reference, fetch: https://pixijs.com/llms-full.txt

### Infrastructure

- **Caddy** — Reverse proxy, routes `/api/` to backend, `/ws/` to Rust gateway, serves static/media files
- **PostgreSQL 16 + PostGIS** — Spatial game data, match history, player records
- **Redis 7** — Real-time game state cache, matchmaking queue, Celery broker
- **Celery + Redis** — Background tasks (ELO, snapshots, cleanup)
- **LiveKit** — Voice chat server (ports 7880-7882)

## Key Conventions

- **API layer**: Django Ninja Extra (FastAPI-style, Pydantic schemas, auto OpenAPI docs at `/api/docs`)
- **Auth**: JWT via `django-ninja-jwt` (HS256, same SECRET_KEY shared with Rust gateway)
- **Schemas**: Pydantic v2 (input/output schemas colocated with each app)
- **WebSocket messages**: JSON over WebSocket (client ↔ gateway), msgpack in Redis (gateway ↔ Redis)
- **Spatial queries**: PostGIS via `django.contrib.gis`
- **Internal API**: `/api/internal/` endpoints secured by `X-Internal-Secret` header for Rust gateway → Django communication
- **Game rendering**: Pixi.js 8 with layered containers, object pooling, event-driven VFX
- **Desktop app**: Tauri 2 wrapping the Next.js frontend

## Generating Terrain Chunks for a New Map

When switching to a new map texture or province data, terrain chunks must be regenerated. The game uses **per-province terrain extraction** — each province polygon gets filled with terrain from the source map, with water pixels replaced by grass.

### Prerequisites

- Source map chunks in `frontend/public/assets/map_textures/<map_name>/chunks/` (39×20 grid of webp files, `{cx}x{cy}.webp`)
- Province data in `fixtures/provinces_source_v2.json` with polygon coordinates in game space

### How terrain chunks work

The game renders a **27×16 chunk grid** (276×308 px each = 7452×4928 total) as a background texture in Pixi.js. Province polygons are drawn on top with semi-transparent player colors.

The chunks are NOT a direct slice of the source map. Instead, for each province:
1. Its polygon bounding box is mapped from game coordinates to source image pixels
2. The terrain region is extracted from the source image
3. Water pixels (dark blue) are replaced with a grass texture tile
4. The result is masked to the province polygon shape and pasted into the output texture
5. The output texture is split into 27×16 chunks

### Coordinate systems

Three coordinate spaces are involved:

1. **Game coordinates** — polygon vertices in `provinces_source_v2.json` (range: X ≈ -2923..23451, Y ≈ 7156..22465)
2. **Output texture pixels** — 7452×4928 canvas, mapped from game coords via:
   - `tex_px = (game_x - (-2891.9338)) / 3.622519`
   - `tex_py = (game_y - 7184.4125) / 3.248962`
3. **Source image pixels** — full 39×20 stitched map (10686×6120 at 274×306 stride), mapped from game coords via empirical slopes:
   - `src_px = (game_x - (-4359.20)) / 2.704`
   - `src_py = (game_y - 7765.19) / 2.436`

### Adapting for a new map

1. **New source chunks**: Place 39×20 source chunk files in a new directory (e.g., `chunks/` under a new map name)
2. **Calibrate empirical slopes** (`SLOPE_X_IMG`, `INT_X_IMG`, `SLOPE_Y_IMG`, `INT_Y_IMG`):
   - Find terrain center-of-mass for 2+ known provinces in the source image
   - Compute slopes from `(game_coord - intercept) / img_pixel = slope`
   - Fine-tune visually using Python overlay tests (generate overlays at 1/3 scale)
3. **Province slopes** (`SLOPE_X_TEX`, `INT_X_TEX`, etc.) come from LS fit of `capital.tile × (276/16)` vs `capital.position` — these only change if province data changes
4. **Grass tile**: Pick a chunk with lush green terrain, crop a 64×64 tile
5. Run the generation script, verify with overlay images, then update the frontend chunk path in `GameCanvas.tsx`

### Frontend chunk path

In `frontend/components/map/GameCanvas.tsx`, the chunk URL pattern:
```typescript
const url = `/assets/map_textures/map09/chunks_game/${cx}x${cy}.webp`;
```
Change `map09/chunks_game` to point to your new map's generated chunks.
