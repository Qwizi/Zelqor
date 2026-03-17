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
docker compose up          # Start all services (db, redis, backend, celery, celery-beat, frontend, gateway, caddy)
docker compose up backend  # Start specific service
```

Ports in dev: Caddy on 80, backend on 8002, frontend on 3002, gateway on 8080, PostgreSQL on 5433, Redis on 6380.

## Architecture

### Backend (Django)

Six Django apps under `apps/`:

- **accounts** — User model, JWT auth, profiles
- **geo** — Geospatial data (Country, Region) using PostGIS
- **game_config** — Admin-configurable game settings (building/unit types, costs)
- **matchmaking** — Match queue and player pairing; creates Match objects; internal API for Rust gateway
- **game** — Match models, snapshots, internal API for Rust gateway; Celery tasks (ELO, cleanup)
- **shop** — Shop items and categories (placeholder)

Key config under `config/`:
- `asgi.py` — ASGI entry point (HTTP only, WebSocket handled by Rust gateway)
- `celery.py` — Celery app config
- `settings.py` — Main settings using `python-decouple` for env vars

### Rust Gateway (`gateway/`)

Cargo workspace with 5 crates handling all WebSocket traffic:

- **maplord-gateway** — Binary: axum WS server, JWT auth, routing, game consumer
- **maplord-engine** — Lib: pure game logic (tick processing, combat, economy, pathfinding)
- **maplord-state** — Lib: Redis state management with msgpack (rmp-serde)
- **maplord-matchmaking** — Lib: matchmaking queue logic with DashMap connection groups
- **maplord-django** — Lib: Django internal API client (reqwest)

### Real-time Game Flow

```
Client ↔ WebSocket ↔ Rust Gateway (auth, matchmaking, game loop, engine)
                           ↓
                     Redis (live state, msgpack)
                           ↓
              Django HTTP Internal API (match creation, snapshots, ELO)
              Celery (async cleanup, stale match handling)
```

Game state is stored in Redis (via msgpack/rmp-serde serialization) during active matches; Celery periodically snapshots state to PostgreSQL and runs post-match ELO calculations. The Rust gateway communicates with Django via internal HTTP API (`/api/internal/`) secured by `X-Internal-Secret` header.

### Frontend

Next.js 16 App Router with TypeScript:

- `app/` — Pages (App Router)
- `components/` — React components (ui, map, game, auth)
- `lib/api.ts` — REST API client
- `lib/ws.ts` — WebSocket client
- `hooks/` — Custom React hooks

Key libraries: MapLibre GL (map rendering), shadcn/ui + Tailwind CSS 4 (UI), React Hook Form + Zod (form validation), Sonner (toasts).

### Infrastructure

- **Caddy** — Reverse proxy, routes `/api/` to backend, `/ws/` to Rust gateway, serves static/media files
- **PostgreSQL 16 + PostGIS** — Spatial game data, match history, player records
- **Redis 7** — Real-time game state cache, matchmaking queue
- **Celery + Redis** — Background tasks (ELO, snapshots, cleanup)

## Key Conventions

- **API layer**: Django Ninja Extra (FastAPI-style, Pydantic schemas, auto OpenAPI docs at `/api/docs`)
- **Auth**: JWT via `django-ninja-jwt` (HS256, same SECRET_KEY shared with Rust gateway)
- **Schemas**: Pydantic v2 (input/output schemas colocated with each app)
- **WebSocket messages**: JSON over WebSocket (client ↔ gateway), msgpack in Redis (gateway ↔ Redis)
- **Spatial queries**: PostGIS via `django.contrib.gis`
- **Internal API**: `/api/internal/` endpoints secured by `X-Internal-Secret` header for Rust gateway → Django communication

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

### Generation script

Run with `uv run python` (needs numpy and Pillow):

```bash
uv run python generate_terrain_chunks.py
```

The script (inline version):

```python
from PIL import Image, ImageDraw
import json, os, numpy as np

# --- Config: adjust these for a new map ---
FIXTURE_PATH = "fixtures/provinces_source_v2.json"
SOURCE_CHUNK_DIR = "frontend/public/assets/map_textures/map09/chunks/"
OUTPUT_DIR = "frontend/public/assets/map_textures/map09/chunks_game/"
GRASS_CHUNK = "33x16"  # chunk with good green grass for water replacement
GRASS_CROP = (100, 100, 164, 164)  # 64x64 region within that chunk

# Source image grid (39x20 chunks at 274x306 stride)
SRC_COLS, SRC_ROWS = 39, 20
SRC_COL_STRIDE, SRC_ROW_STRIDE = 274, 306

# Output texture grid (27x16 chunks at 276x308)
OUT_COLS, OUT_ROWS = 27, 16
OUT_CHUNK_W, OUT_CHUNK_H = 276, 308

# Game coord → output texture mapping (province coordinate system)
SLOPE_X_TEX, INT_X_TEX = 3.622519, -2891.9338
SLOPE_Y_TEX, INT_Y_TEX = 3.248962, 7184.4125

# Game coord → source image mapping (empirical fit)
SLOPE_X_IMG, INT_X_IMG = 2.704, -4359.20
SLOPE_Y_IMG, INT_Y_IMG = 2.436, 7765.19
# --- End config ---

with open(FIXTURE_PATH) as f:
    data = json.load(f)

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Stitch source image
FULL_W = SRC_COLS * SRC_COL_STRIDE
FULL_H = SRC_ROWS * SRC_ROW_STRIDE
full_img = Image.new("RGB", (FULL_W, FULL_H), (30, 50, 80))
for cx in range(SRC_COLS):
    for cy in range(SRC_ROWS):
        chunk = Image.open(f"{SOURCE_CHUNK_DIR}/{cx}x{cy}.webp").convert("RGB")
        chunk = chunk.crop((0, 0, SRC_COL_STRIDE, SRC_ROW_STRIDE))
        full_img.paste(chunk, (cx * SRC_COL_STRIDE, cy * SRC_ROW_STRIDE))

# Grass tile
grass = Image.open(f"{SOURCE_CHUNK_DIR}/{GRASS_CHUNK}.webp").convert("RGB")
grass_tile = grass.crop(GRASS_CROP)
tw, th = grass_tile.size

# Tile grass across full output
OUT_W = OUT_COLS * OUT_CHUNK_W
OUT_H = OUT_ROWS * OUT_CHUNK_H
grass_full = Image.new("RGB", (OUT_W, OUT_H))
for x in range(0, OUT_W, tw):
    for y in range(0, OUT_H, th):
        grass_full.paste(grass_tile, (x, y))
grass_arr = np.array(grass_full)

# Render provinces
canvas = Image.new("RGB", (OUT_W, OUT_H), (25, 50, 90))

for p in data["provinces"]:
    polys = p.get("polygons", [])
    if not polys:
        continue
    all_gx, all_gy = [], []
    for poly in polys:
        for pt in poly["points"]:
            x, y = pt.split(",")
            all_gx.append(float(x))
            all_gy.append(float(y))
    if not all_gx:
        continue

    gx_min, gx_max = min(all_gx), max(all_gx)
    gy_min, gy_max = min(all_gy), max(all_gy)

    # Output bbox
    out_x0 = int((gx_min - INT_X_TEX) / SLOPE_X_TEX)
    out_x1 = int((gx_max - INT_X_TEX) / SLOPE_X_TEX) + 1
    out_y0 = int((gy_min - INT_Y_TEX) / SLOPE_Y_TEX)
    out_y1 = int((gy_max - INT_Y_TEX) / SLOPE_Y_TEX) + 1
    out_w, out_h = out_x1 - out_x0, out_y1 - out_y0
    if out_w < 1 or out_h < 1:
        continue

    # Source bbox
    src_x0 = max(0, min(FULL_W - 1, int((gx_min - INT_X_IMG) / SLOPE_X_IMG)))
    src_x1 = max(1, min(FULL_W, int((gx_max - INT_X_IMG) / SLOPE_X_IMG) + 1))
    src_y0 = max(0, min(FULL_H - 1, int((gy_min - INT_Y_IMG) / SLOPE_Y_IMG)))
    src_y1 = max(1, min(FULL_H, int((gy_max - INT_Y_IMG) / SLOPE_Y_IMG) + 1))
    if src_x1 <= src_x0 or src_y1 <= src_y0:
        continue

    terrain = full_img.crop((src_x0, src_y0, src_x1, src_y1))
    terrain = terrain.resize((out_w, out_h), Image.BICUBIC)

    # Replace water with grass
    arr = np.array(terrain)
    oy0, ox0 = max(0, out_y0), max(0, out_x0)
    g = grass_arr[oy0 : oy0 + out_h, ox0 : ox0 + out_w]
    if g.shape[:2] != arr.shape[:2]:
        g = np.array(Image.fromarray(g).resize((out_w, out_h)))
    water = (arr[:, :, 2] > arr[:, :, 1]) & (arr[:, :, 2] > 60) & (arr[:, :, 1] < 90) & (arr[:, :, 0] < 60)
    arr[water] = g[water]
    terrain = Image.fromarray(arr)

    # Polygon mask
    mask = Image.new("L", (out_w, out_h), 0)
    dm = ImageDraw.Draw(mask)
    for poly in polys:
        pts = poly["points"]
        if len(pts) < 3:
            continue
        local = [
            ((float(pt.split(",")[0]) - INT_X_TEX) / SLOPE_X_TEX - out_x0,
             (float(pt.split(",")[1]) - INT_Y_TEX) / SLOPE_Y_TEX - out_y0)
            for pt in pts
        ]
        dm.polygon(local, fill=255)

    px, py = max(0, out_x0), max(0, out_y0)
    if px < OUT_W and py < OUT_H:
        canvas.paste(terrain, (px, py), mask)

# Split into chunks
for cx in range(OUT_COLS):
    for cy in range(OUT_ROWS):
        x0, y0 = cx * OUT_CHUNK_W, cy * OUT_CHUNK_H
        chunk = canvas.crop((x0, y0, x0 + OUT_CHUNK_W, y0 + OUT_CHUNK_H))
        chunk.save(f"{OUTPUT_DIR}/{cx}x{cy}.webp", "webp", quality=90)

print(f"Done — {OUT_COLS * OUT_ROWS} chunks in {OUTPUT_DIR}")
```

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
