# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MapLord 2.0** is a real-time strategy web game built on a world map. Players claim territories, build armies, and compete in real-time matches. The project uses CalVer versioning (e.g., `v2026.3.10.1`).

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

### Frontend (Next.js)

Uses `pnpm` as the package manager. Run from the `frontend/` directory.

```bash
pnpm dev      # Dev server on port 3000
pnpm build    # Production build
pnpm lint     # ESLint
```

### Docker Compose (recommended for full-stack dev)

```bash
docker compose up          # Start all services (db, redis, backend, celery, celery-beat, frontend, caddy)
docker compose up backend  # Start specific service
```

Ports in dev: Caddy on 80, backend on 8002, frontend on 3002, PostgreSQL on 5433, Redis on 6380.

## Architecture

### Backend

Six Django apps under `apps/`:

- **accounts** — User model, JWT auth, profiles
- **geo** — Geospatial data (Country, Region) using PostGIS
- **game_config** — Admin-configurable game settings (building/unit types, costs)
- **matchmaking** — Match queue and player pairing; creates Match objects
- **game** — Core game loop (asyncio in WebSocket consumer), combat, Redis state management
- **shop** — Shop items and categories (placeholder)

Key config under `config/`:
- `asgi.py` — ASGI entry point + Django Channels WebSocket routing
- `routing.py` — WebSocket URL patterns
- `celery.py` — Celery app config
- `settings.py` — Main settings using `python-decouple` for env vars

### Real-time Game Flow

```
Client ↔ WebSocket ↔ Django Channels Consumer → asyncio Game Loop
                                                      ↓
                                               Redis (live state)
                                                      ↓
                                        Celery (async: snapshots → PostgreSQL, ELO)
```

Game state is stored in Redis (via msgpack serialization) during active matches; Celery periodically snapshots state to PostgreSQL and runs post-match ELO calculations.

### Frontend

Next.js 16 App Router with TypeScript:

- `app/` — Pages (App Router)
- `components/` — React components (ui, map, game, auth)
- `lib/api.ts` — REST API client
- `lib/ws.ts` — WebSocket client
- `hooks/` — Custom React hooks

Key libraries: MapLibre GL (map rendering), shadcn/ui + Tailwind CSS 4 (UI), React Hook Form + Zod (form validation), Sonner (toasts).

### Infrastructure

- **Caddy** — Reverse proxy, routes `/api/` and `/ws/` to backend, serves static/media files
- **PostgreSQL 16 + PostGIS** — Spatial game data, match history, player records
- **Redis 7** — Real-time game state cache, Django Channels channel layer, matchmaking queue
- **Celery + Redis** — Background tasks (matchmaking, ELO, snapshots)

## Key Conventions

- **API layer**: Django Ninja Extra (FastAPI-style, Pydantic schemas, auto OpenAPI docs at `/api/docs`)
- **Auth**: JWT via `django-ninja-jwt`
- **Schemas**: Pydantic v2 (input/output schemas colocated with each app)
- **WebSocket messages**: msgpack binary serialization (not JSON) for efficiency
- **Spatial queries**: PostGIS via `django.contrib.gis`
