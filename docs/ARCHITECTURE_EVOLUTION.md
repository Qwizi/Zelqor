# MapLord — Architecture Evolution Plan

Document created: 2026-03-27
Purpose: Capture architectural decisions and exploration from brainstorming session.

---

## 1. Current Architecture Summary

```
Client ↔ WebSocket ↔ Rust Gateway (auth, matchmaking, game loop, engine, AI bots, anticheat)
                           ↓
                     Redis (live state, msgpack)
                           ↓
              Django HTTP Internal API (match creation, snapshots, ELO)
              Celery (async cleanup, stale match handling)
```

**Stack**: Django + Rust Gateway + Redis + PostgreSQL + Celery + Next.js + Caddy
**VPS**: OVH, 8GB RAM, 4 vCores
**Capacity estimate**: ~200-300 concurrent matches, ~2500-3000 matches/day, ~1000-1500 players

---

## 2. Identified Architectural Gaps

### Critical (implement first)
1. **No Circuit Breaker / Retry** — Rust gateway → Django HTTP calls fail immediately, no backoff, no resilience
2. **No Graceful Shutdown** — No SIGTERM handler in gateway, in-flight requests killed, Redis state potentially inconsistent
3. **No Dead Letter Queue** — Failed Celery tasks silently dropped

### Important (before scaling)
4. **No Event Bus / Outbox Pattern** — `finalize_match_results_sync()` is a synchronous monolith touching 7+ tables
5. **No Distributed Tracing** — Cannot correlate requests across Gateway → Django → Celery
6. **No Secret Rotation / mTLS** — `X-Internal-Secret` is plain string, never rotated

### Strategic (at growth)
7. **No CQRS / Read Replicas** — Single PostgreSQL for everything
8. **No Event Sourcing** — Only snapshots every 30 ticks, cannot replay intermediate game states
9. **No Blue/Green Deployment** — Restart = downtime, active matches lost
10. **No Internal Rate Limiting** — Gateway can flood Django with requests

---

## 3. Microservices Extraction Plan

### Strangler Fig Pattern — phased extraction from monolith

### Phase 1: Easy wins (low coupling)
| Service | Effort | Benefit | Blocker |
|---------|--------|---------|---------|
| **Notifications** | 2/10 | High | None |
| **Chat** | 3/10 | Medium | None |
| **Geo/Map** | 2/10 | Low | None |

### Phase 2: Medium effort
| Service | Effort | Benefit | Blocker |
|---------|--------|---------|---------|
| **Game Config** | 3/10 | Medium | None |
| **Inventory** | 7/10 | Very High | Atomic transactions |
| **Marketplace** | 6/10 | High | Depends on Inventory |

### Phase 3: Complex
| Service | Effort | Benefit | Blocker |
|---------|--------|---------|---------|
| **Clans** | 8/10 | High | Depends on Inventory + Matchmaking |

### Keep in monolith
- **Matchmaking** — central orchestrator, touches everything
- **Game Results** — synchronous critical path, 7+ table updates
- **Accounts** — hub model, referenced everywhere

### Key challenge: Atomic transactions
- Marketplace: deduct gold + transfer items atomically
- Crafting: consume ingredients + produce items atomically
- Matches: consume deck items + generate drops atomically
- Solution: Saga pattern + compensating transactions (or keep together)

---

## 4. Observability Stack

### Decision: ClickHouse (self-hosted) + Grafana Cloud (free tier)

**ClickHouse** (self-hosted on VPS):
- Game analytics, player behavior, meta analysis
- ~256-512MB RAM
- Apache 2.0 license, free

**Grafana Cloud** (free tier, NOT self-hosted):
- 50GB traces/month, 50GB logs/month
- Zero RAM cost on VPS
- Traces (Tempo), Logs (Loki), Dashboards

**OpenTelemetry Collector** (self-hosted):
- Routes data to Grafana Cloud + ClickHouse
- ~50MB RAM

### Integration points
- **Rust Gateway**: `tracing-opentelemetry` crate (already uses `tracing`)
- **Django**: `opentelemetry-instrumentation-django` (auto-instrumentation)
- **Propagation**: `traceparent` header in Gateway → Django HTTP calls
- **Celery**: OpenTelemetry Celery instrumentation

### What Grafana gives us
- Distributed tracing: Frontend → Caddy → Gateway → Redis + Django → Celery
- Log correlation via `trace_id`
- Dashboards: game health, API latency, Celery queue depth
- Alerts: error rate spikes, slow queries, DLQ depth

---

## 5. Game Analytics with ClickHouse

### Purpose
Collect gameplay data to understand meta, balance, player behavior:
- What units/buildings are used vs ignored?
- What strategies win most?
- What needs nerfing/buffing?
- Player retention patterns

### Data pipeline
```
Rust Gateway (game events per tick)
  → Redis Streams (buffer)
    → ETL Worker (Python/Rust)
      → ClickHouse (columnar analytics DB)
        → Grafana dashboards
```

### Event types to collect
- Player actions (move, build, train, attack)
- Combat results (attacker, defender, units, outcome)
- Economy (income, spending, gold over time)
- Match outcomes (winner, duration, ELO changes)
- Unit/building usage frequency
- Strategy patterns (early rush, turtle, economic)

---

## 6. Event Log — Fixing Snapshot Gaps

### Problem
Snapshots every 30 ticks (30s). Between snapshots = black hole. Replay system works but plays like 0.03 FPS video.

### Solution: Snapshot + Event Log hybrid
```
Snapshot (tick 0) + Events (tick 1-30) + Snapshot (tick 30) + Events (tick 31-60) ...
```

- **Snapshots** = checkpoints (fast seek to any moment)
- **Events** = fill gaps (smooth replay between snapshots)
- **Replay**: find nearest snapshot ≤ target tick, replay events to target

### Event log cost
~100-500 bytes per event, ~50 events/min per match = ~1.5MB per 1-hour match

### Bonus
- Smooth replay system (1 FPS = smooth for strategy)
- Full audit trail for anticheat
- Production debugging (what happened at tick 17?)
- Feeds directly into ClickHouse analytics pipeline (same events)

---

## 7. Community Servers

### Architecture: Gateway + GameNode separation

```
gateway/crates/
├── maplord-gateway        # Central: auth, routing, registry, matchmaking
├── maplord-gamenode       # NEW: lightweight game server for community hosting
├── maplord-engine         # Game logic (used by gamenode)
├── maplord-state          # Redis state (used by gamenode)
├── maplord-ai             # Bots (used by gamenode)
├── maplord-anticheat      # Anticheat (used by gamenode)
├── maplord-matchmaking    # Stays in gateway
└── maplord-django         # Stays in gateway
```

### Responsibility split

| | `maplord-gateway` (central) | `maplord-gamenode` (community) |
|---|---|---|
| Auth | JWT validation, user sessions | Receives token from gateway, trusts it |
| Matchmaking | Yes | No — gateway assigns players |
| Game loop | Delegates to nodes | Yes — tick processing, engine |
| Redis | Registry, queue | Local Redis for game state |
| Django API | Full access | Zero — reports results to gateway |
| WebSocket | Proxy / routing | Direct to players |
| Config | Validates and distributes | Receives from gateway |
| Anticheat | Aggregates reports | Collects data, sends to gateway |
| Bots | - | Local AI |

### Official server = also a gamenode
The official ranked server runs as a gamenode instance managed by the gateway. Same code path, no special cases.

### Flow
1. Community registers server → gateway assigns server_id + credentials
2. Gamenode starts → connects to gateway (gRPC/WS): "I'm online, config X"
3. Player looks for game → gateway: "community server has your mode"
4. Player joins → gateway issues ticket → player connects WS to gamenode
5. Match plays → gamenode runs game loop locally
6. Match ends → gamenode sends results to gateway → gateway → Django (ELO, drops)

### Server browser
New frontend page: list of servers with status, player count, config, filters, join button.

---

## 8. Plugin System (WASM)

### Architecture
```
maplord-gamenode
├── maplord-engine (core logic)
├── maplord-plugins (NEW crate)
│   ├── PluginHost (wasmtime runtime)
│   ├── PluginAPI (what plugins can do)
│   ├── EventBus (hook system)
│   └── PluginSandbox (CPU/RAM/call limits)
```

### Technology: WASM Components (W3C standard)
- **Runtime**: wasmtime (Rust-native, Bytecode Alliance)
- **Contract**: WIT (WebAssembly Interface Types) — define once, generate bindings for all languages
- **Languages**: Rust (native), TypeScript (ComponentizeJS), Python (componentize-py)

### Plugin SDK
```bash
# Python
pip install maplord-plugin-sdk
maplord-sdk build my_plugin.py → my_plugin.wasm

# TypeScript
pnpm add @maplord/plugin-sdk
maplord-sdk build my_plugin.ts → my_plugin.wasm

# Rust
cargo component build --release
```

### Sandbox limits per plugin
- Max memory: 16MB
- Max CPU per tick: 5ms (timeout = kill)
- Max host calls per tick: 1000
- Max KV storage: 1MB
- Blocked: filesystem, network, system calls, other plugins

### Hook execution order per tick
```
Engine tick start
  1. Engine processes player actions
  2. on_player_action() → plugins can Allow/Deny/Modify
  3. Engine resolves combat
  4. on_combat_resolve() → plugins can modify result
  5. Engine calculates income
  6. on_income_tick() → plugins can modify gold
  7. on_tick() → plugins run custom logic
  8. Engine finalizes state
Engine tick end → broadcast state to clients
```

### Plugin manifest
```json
{
    "name": "zombie-mode",
    "version": "1.0.0",
    "author": "community_user",
    "hooks": ["on_match_start", "on_tick", "on_region_capture"],
    "permissions": ["spawn_units", "set_region_owner", "broadcast_message"],
    "min_engine_version": "2026.3.0"
}
```

### Implementation phases
1. **Event hooks (read-only)** — plugins see events, can broadcast_message
2. **Modifiers (Allow/Deny/Modify)** — plugins affect gameplay
3. **Full host API** — spawn_units, set_gold, custom game modes
4. **Plugin registry** — community marketplace (like Steam Workshop)

### Example plugins
- **Zombie Mode** — random player becomes zombie, infected regions auto-spawn units
- **Battle Royale** — map shrinks every 60s, edge regions eliminated
- **Economy Tweaks** — comeback mechanics (double income for weakest player)
- **Kill Streak Announcer** — CS-style kill streak messages

---

## 9. Rebranding Candidates

Current name: MapLord 2.0 — not unique enough.

### Top candidates
| Name | Vibe | Domain |
|------|------|--------|
| **REDRAW** | "Redraw the borders" — literally describes gameplay | redraw.gg |
| **VORN** | Mysterious, Nordic feel, like Valheim | vorn.gg |
| **PANGEA** | Supercontinent, everyone knows it, nobody used it for a game | pangea.gg |
| **ANNEX** | "To annex territory" — aggressive, elegant, memeable | annex.gg |
| **SOVRA** | From "sovereignty" — elegant, works in all languages | sovra.io |
| **FRACTURE** | Map breaks apart, dark competitive vibe | fracture.gg |

### Checklist before deciding
- [ ] Domain availability (.gg, .io)
- [ ] Trademark search (EUIPO / USPTO)
- [ ] Steam / App Store / Google Play name check
- [ ] Social media handles (@name on X, Discord, Reddit)

---

## 10. Infrastructure Priorities

### Implementation order

```
Phase 1 — Resilience (now):
  ├── Circuit Breaker + Retry (Gateway ↔ Django)
  ├── Graceful Shutdown (SIGTERM handler in gateway)
  └── Dead Letter Queue (Celery)

Phase 2 — Observability:
  ├── OpenTelemetry integration (Gateway + Django)
  ├── Grafana Cloud free tier setup
  ├── ClickHouse for game analytics
  └── Event Log (fix snapshot gaps)

Phase 3 — Architecture:
  ├── Event Bus / Outbox Pattern
  ├── Secret Rotation / mTLS (RS256 JWT)
  └── Notification + Chat service extraction

Phase 4 — Community:
  ├── maplord-gamenode crate (split from gateway)
  ├── Server registry + browser
  ├── Plugin system (WASM + wasmtime)
  └── Plugin SDK (Python, TypeScript, Rust)

Phase 5 — Scale:
  ├── CQRS / Read Replicas
  ├── Blue/Green Deployment
  └── Rebranding + launch
```

### VPS scaling path (OVH)
- Current: 8GB RAM / 4 vCores — handles ~2500-3000 matches/day
- Upgrade when CPU sustained >70%
- OVH allows instant upgrade (reboot required), no downgrade without migration
- Next tier: 16GB / 8 cores → ~6000+ matches/day

---

## 11. Tick System

Game uses 1 tick/second (configurable). Similar concept to CS2 tickrate (64-128/s) but MapLord is strategy, not FPS — 1/s is sufficient.

- CPU per tick: ~10ms per match
- Bottleneck: CPU, not RAM
- 4 vCores can handle ~200-300 concurrent matches at 1 tick/s

Increasing tick rate to 10/s = smoother unit movement animations but 10x CPU cost. Not recommended unless gameplay demands it.
