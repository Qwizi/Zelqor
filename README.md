# Zelqor

Real-time strategy web game on a world map. Players claim territories, build armies, and compete in live matches.

## Architecture

```
Client <-> WebSocket <-> Rust Gateway (auth, matchmaking, game loop, AI bots, anticheat)
                              |
                        Redis (live state, msgpack)
                              |
                 Django HTTP Internal API (match creation, snapshots, ELO)
                 Celery (async cleanup, stale match handling)
```

**Backend** — Django 5.2, Django Ninja Extra, Celery, PostgreSQL, Redis. Eleven apps: accounts, geo, game_config, matchmaking, game, chat, inventory, marketplace, crafting, developers, notifications, assets.

**Gateway** — Rust (axum) WebSocket server. Cargo workspace with 7 crates: gateway, engine, state, matchmaking, django client, AI bots, anticheat. Handles all real-time traffic — tick processing, combat, economy, pathfinding. State lives in Redis via msgpack.

**Frontend** — Next.js 16 (App Router), TypeScript, Pixi.js 8 for game rendering, shadcn/ui + Tailwind CSS 4. Desktop builds via Tauri 2.

**Infra** — Caddy reverse proxy, PostgreSQL 16, Redis 7, LiveKit (voice chat).

## Requirements

- Python 3.13+ with [uv](https://docs.astral.sh/uv/)
- Rust 1.88+
- Node.js (LTS) with pnpm
- Docker and Docker Compose (recommended)

## Quick Start

Docker Compose brings up everything:

```bash
cp .env.example .env    # configure secrets
docker compose up
```

Caddy on :80, backend on :8002, frontend on :3002, gateway on :8080.

## Development (without Docker)

Backend:

```bash
uv sync
uv run python manage.py migrate
uv run python manage.py runserver          # :8000
uv run celery -A config worker -l info
uv run celery -A config beat -l info
```

Gateway:

```bash
cd gateway
cargo build
cargo run --bin zelqor-gateway            # :8080
```

Frontend:

```bash
cd frontend
pnpm install
pnpm dev                                   # :3000
```

## Testing

```bash
uv run pytest apps/ -q                     # backend (94% coverage)
cd gateway && cargo test                   # gateway unit tests
cd frontend && pnpm vitest run             # frontend unit tests
```

## API Docs

Django Ninja auto-generates OpenAPI docs at `/api/docs` when the backend is running.

## Versioning

CalVer: `vYYYY.M.DD.patch` (e.g. `v2026.3.26.1`).

## License

[MIT](LICENSE)
