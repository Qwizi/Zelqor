# Load Testing Strategy — Zelqor 2.0

## 1. Architektura systemu (podsumowanie pod kątem obciążenia)

```
Client (browser)
  ├─ HTTP REST → Caddy → Django (auth, matchmaking API, game results, shop, inventory)
  ├─ WebSocket → Caddy → Rust Gateway (matchmaking WS, game loop, chat)
  │                          ├─ Redis (msgpack game state, ~0.5-1MB per match)
  │                          └─ Django Internal API (match creation, snapshots, finalize)
  └─ LiveKit (voice chat, opcjonalne)

Background:
  Celery Worker → cleanup stale matches (co 5min), cleanup queue (co 3min),
                  cleanup lobbies (co 30s), marketplace restock (co 1h)
```

### Kluczowe parametry systemu

| Parametr | Wartość |
|----------|---------|
| **Game tick rate** | 1000ms (1 tick/s) |
| **Snapshot do DB** | co 30 ticków (30s) |
| **Max akcji/s per user** | 30 (rate limit) |
| **Chat rate limit** | 1 msg/s per user |
| **Bot fill timeout** | 30s (auto-fill boty) |
| **Redis state per match** | ~0.5–1MB (6 graczy × 100+ regionów, msgpack) |
| **Lobby TTL** | 10 min |
| **Anti-cheat flood** | 20 actions/tick × 5 ticków = flag |

---

## 2. Profile ruchu — scenariusze obciążeniowe

### Scenariusz A: "Normalny wieczór" — 50 CCU (Concurrent Users)

| Komponent | Ruch |
|-----------|------|
| **Aktywne mecze** | ~8 meczy (6 graczy = 48 w grze + 2 w queue) |
| **WebSocket connections** | 50 (1 per user) |
| **WS messages IN (akcje)** | ~5 akcji/s/gracz × 48 = **~240 msg/s** |
| **WS messages OUT (events)** | ~10 events/tick × 8 meczy × broadcast 6 = **~480 msg/s** |
| **Redis ops** | ~8 HGETALL + 8 HSET per tick × 8 meczy = **~128 ops/s** |
| **Django Internal API** | snapshot co 30s × 8 = **~0.27 req/s** + matchmaking bursts |
| **REST API (HTTP)** | login, leaderboard, config = **~5–10 req/s** |
| **Celery tasks** | snapshot: ~16/min, finalize: ~2/min |
| **RAM Redis** | 8 × 1MB = **~8MB** |
| **DB connections** | ~10–15 (Django pool) |

### Scenariusz B: "Szczyt popularności" — 200 CCU

| Komponent | Ruch |
|-----------|------|
| **Aktywne mecze** | ~33 meczy |
| **WebSocket connections** | 200 |
| **WS messages IN** | **~1,000 msg/s** |
| **WS messages OUT** | **~2,000 msg/s** |
| **Redis ops** | **~530 ops/s** |
| **Django Internal API** | **~1.1 req/s** snapshots + matchmaking |
| **REST API** | **~30–50 req/s** |
| **Celery tasks** | snapshot: ~66/min |
| **RAM Redis** | **~33MB** |
| **DB connections** | ~20–30 |

### Scenariusz C: "Stress test" — 1000 CCU

| Komponent | Ruch |
|-----------|------|
| **Aktywne mecze** | ~166 meczy |
| **WebSocket connections** | 1,000 |
| **WS messages IN** | **~5,000 msg/s** |
| **WS messages OUT** | **~10,000 msg/s** |
| **Redis ops** | **~2,660 ops/s** |
| **Django Internal API** | **~5.5 req/s** snapshots |
| **REST API** | **~100–200 req/s** |
| **Celery tasks** | snapshot: ~332/min, finalize: ~30/min |
| **RAM Redis** | **~166MB** |
| **DB connections** | ~50–80 |

---

## 3. Wąskie gardła (Bottleneck Analysis)

| Priorytet | Komponent | Problem | Kiedy uderzy |
|-----------|-----------|---------|---------------|
| **1** | **Rust Gateway** | Każdy mecz = 1 tokio task z game loop. Przy 166 meczach = 166 tasków tickujących co 1s + broadcast. CPU-bound engine processing. | >100 meczy |
| **2** | **Redis** | Duże HGETALL/HSET na regionach (~100 keys per hash). Msgpack ser/deser per tick per match. Single-threaded Redis. | >2,000 ops/s |
| **3** | **Django Internal API** | Snapshot endpoint robi DB write z dużym JSON. `finalize_match_results` liczy ELO + inventory drops. | >50 req/s burst |
| **4** | **PostgreSQL** | PostGIS queries (region neighbors), snapshot writes, concurrent ELO updates. | >100 concurrent matches ending |
| **5** | **Celery** | `concurrency=2` w prod. Przy 332 snapshotach/min = potencjalna kolejka. | >200 CCU |
| **6** | **Caddy** | Proxy overhead na WebSocket upgrade. RAM per connection. | >1,000 connections |

---

## 4. Narzędzia do testów

### Rekomendacja: **k6 + custom WebSocket scripts**

k6 (Grafana) jest najlepszy dla tego projektu bo:
- Natywne wsparcie WebSocket
- Skryptowanie w JavaScript
- Metryki real-time (p95, p99, throughput)
- Łatwe ramping (10→100→1000 users)
- Open source, lekki

Alternatywy:
- **Locust** (Python) — łatwiejszy do napisania, gorsze WS support
- **Artillery** (Node) — dobry WS support, mniej elastyczny
- **Gatling** (Scala) — enterprise-grade, stroma krzywa uczenia

---

## 5. Plan testów

### Faza 1: HTTP REST API (baseline)

**Narzędzie:** k6

```
Scenariusze:
1. Login storm        — 100 req/s register + login
2. Config/Leaderboard — 200 req/s GET endpoints
3. Matchmaking API    — 50 req/s POST /matches/
4. Geo tiles          — 100 req/s GET /geo/tiles/{z}/{x}/{y}/
```

**Metryki:** p95 latency < 200ms, error rate < 1%, throughput

### Faza 2: WebSocket Matchmaking

```
Scenariusze:
1. Lobby join/leave cycle — 50 concurrent WS connections
2. Queue → bot fill → match start — 100 users
3. Rapid connect/disconnect — 200 connections/min
```

**Metryki:** WS handshake time, time-to-match, message delivery latency

### Faza 3: Game Loop (kluczowy test)

```
Scenariusze:
1. Single match — 6 graczy, każdy wysyła 5-10 akcji/s
2. 10 concurrent meczy — 60 graczy, mixed actions
3. 50 concurrent meczy — 300 graczy, stress
4. Endurance — 10 meczy przez 30 min (memory leaks, Redis growth)
```

**Symulacja gracza (k6 WS):**
```
Co tick (1s):
  - 30% szansa: attack (random neighbor region)
  - 20% szansa: build (random owned region)
  - 20% szansa: produce_unit
  - 10% szansa: move (between owned regions)
  - 5% szansa: use_ability
  - 15% szansa: idle (no action)
```

**Metryki:**
- Tick processing time (< 100ms target for 1s tick)
- Event broadcast latency (< 50ms target)
- Redis memory per match
- Actions processed per second
- Message queue backpressure

### Faza 4: Full Stack Integration

```
Ramp-up:
  0-2 min:   10 CCU (2 mecze)
  2-5 min:   50 CCU (8 meczy)
  5-10 min:  200 CCU (33 mecze)
  10-15 min: 500 CCU (83 mecze)
  15-20 min: hold 500 CCU
  20-25 min: ramp down
```

**Metryki do monitorowania:**
- CPU/RAM: gateway, backend, redis, postgres
- Redis: memory, ops/s, keyspace
- Postgres: active connections, query time, WAL size
- Celery: queue length, task duration
- Network: bandwidth per service

### Faza 5: Chaos / Edge Cases

```
1. Mass disconnect — kill 50% WS connections nagle
2. Reconnect storm — 100 users reconnect w 5s
3. Rate limit hammer — 50 users wysyła 50 akcji/s (powyżej limitu 30)
4. Match finalization burst — 20 meczy kończy się jednocześnie
5. Redis restart — jak system się regeneruje
```

---

## 6. Szacunkowe limity sprzętowe

### Production (compose.prod.yml — Raspberry Pi 4 / 4GB)

| Zasób | Limit | Szacowany max CCU |
|-------|-------|--------------------|
| RAM 4GB | shared_buffers=64MB, mem_limit na serwisach | **~50–80 CCU** |
| CPU (4 cores ARM) | Rust gateway + Django + Postgres + Redis | **~30–50 meczy** |
| Redis (no persistence) | ~500MB available | **~500 meczy** (state) |
| PostgreSQL | 64MB shared_buffers | **~50 concurrent queries** |
| Network (1Gbps) | WS broadcast overhead | **~500 CCU** |

**Realistyczny limit prod (RPi4):** **50–80 CCU / 8–13 meczy jednocześnie**

### Cloud/VPS (4 vCPU, 8GB RAM)

| Szacowany max CCU | Warunek |
|--------------------|---------|
| **200–300 CCU** | Single instance, default config |
| **500–1000 CCU** | Redis tuning, Celery concurrency=8, connection pooling |
| **1000+ CCU** | Horizontal scaling (multiple gateway instances, Redis cluster) |

---

## 7. Quick Start — minimalna konfiguracja k6

```bash
# Instalacja k6
# macOS: brew install k6
# Linux: snap install k6

# Struktura plików testowych
load-tests/
├── http/
│   ├── auth-stress.js        # Login/register storm
│   ├── api-baseline.js       # REST endpoints mix
│   └── geo-tiles.js          # Tile endpoint stress
├── ws/
│   ├── matchmaking.js        # WS matchmaking flow
│   ├── game-simulation.js    # Full game loop simulation
│   └── chat-flood.js         # Chat message stress
├── integration/
│   └── full-stack-ramp.js    # Combined ramp-up scenario
└── helpers/
    ├── auth.js               # JWT token management
    └── game-actions.js       # Action generators
```

### Przykładowy skrypt k6 (HTTP baseline):

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // ramp up
    { duration: '3m', target: 50 },   // hold
    { duration: '1m', target: 200 },  // spike
    { duration: '3m', target: 200 },  // hold spike
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export default function () {
  // Login
  const loginRes = http.post(`${BASE_URL}/api/v1/auth/token/pair`, JSON.stringify({
    username: `loadtest_user_${__VU}`,
    password: 'loadtest123',
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'login 200': (r) => r.status === 200 });

  const token = loginRes.json('access');

  // Config
  const configRes = http.get(`${BASE_URL}/api/v1/config/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(configRes, { 'config 200': (r) => r.status === 200 });

  // Leaderboard
  http.get(`${BASE_URL}/api/v1/auth/leaderboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  sleep(1);
}
```

### Przykładowy skrypt k6 (WebSocket game):

```javascript
import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 60,        // 10 meczy × 6 graczy
  duration: '5m',
};

const ACTIONS = ['attack', 'build', 'produce_unit', 'move', 'use_ability'];

export default function () {
  const token = getJwtToken(__VU);
  const url = `ws://localhost/ws/game/?token=${token}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      console.log(`VU ${__VU} connected`);
    });

    socket.on('message', (msg) => {
      const data = JSON.parse(msg);
      // React to game state updates
      if (data.type === 'game_state') {
        // Send random action every tick
        const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
        socket.send(JSON.stringify({
          action: action,
          region_id: Math.floor(Math.random() * 100),
        }));
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 300000); // 5 min match
  });

  check(res, { 'WS status 101': (r) => r && r.status === 101 });
}
```

---

## 8. Podsumowanie priorytetów

1. **Zacznij od HTTP baseline** — najłatwiejsze do zmierzenia, ustali baseline
2. **Następnie WS game loop** — to jest serce systemu, największe ryzyko
3. **Integration ramp-up** — pełny obraz
4. **Przed produkcją** — endurance test (30 min+) na docelowym sprzęcie (RPi4)

Kluczowe KPI:
- **Tick processing** < 100ms (masz 1000ms budżetu)
- **WS latency** < 50ms (p95)
- **HTTP API** < 200ms (p95)
- **Error rate** < 1%
- **Redis memory** rośnie liniowo, nie wykładniczo
