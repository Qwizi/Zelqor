#!/usr/bin/env python3
"""
MapLord Anti-Cheat Test Script
==============================
Symuluje zachowania cheatera na prawdziwym meczu.
Podlacz sie do meczu (np. tutorial) i uruchom ten skrypt.

Uzycie:
    python scripts/cheat_simulator.py --token JWT_TOKEN --match-id MATCH_ID [--mode MODE]

Tryby (--mode):
    flood       - Spam 50 ataków/tick przez 10 ticków (testuje ActionFlood)
    timing      - Burst 100 akcji w <50ms (testuje ImpossibleTiming)
    pattern     - Powtarza identyczną sekwencję 8 akcji 5 razy (testuje RepetitivePattern)
    fog         - Atakuje losowe regiony (testuje FogOfWarAbuse)
    escalate    - Łączy wszystkie tryby żeby eskalować do CancelMatch
    all         - Uruchamia każdy tryb po kolei

Jak zdobyc token:
    1. Zaloguj sie w przegladarce
    2. Otwórz DevTools > Application > Local Storage > maplord_access
    3. Skopiuj wartość

Jak zdobyc match_id:
    1. Wejdz do meczu (np. tutorial)
    2. URL: /game/MATCH_ID  <- to jest match_id
"""

import argparse
import asyncio
import json
import sys
import time

try:
    import websockets
except ImportError:
    print("Brak biblioteki websockets. Zainstaluj:")
    print("  pip install websockets")
    sys.exit(1)


# ============================================================================
# Config
# ============================================================================

DEFAULT_WS_URL = "ws://localhost:8080"
TICK_INTERVAL = 1.0  # sekundy (domyslny tick interval)


# ============================================================================
# Helpers
# ============================================================================


async def connect(ws_url: str, match_id: str, token: str):
    """Polacz sie z WebSocket gry."""
    url = f"{ws_url}/ws/game/{match_id}/?token={token}"
    print(f"[*] Laczenie z {url}")
    ws = await websockets.connect(url, max_size=10 * 1024 * 1024)
    print("[+] Polaczono!")

    # Odbierz initial state
    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
    data = json.loads(msg)
    print(f"[+] Otrzymano initial state (type={data.get('type')})")

    return ws, data


def find_player_regions(state: dict, player_id: str) -> list[dict]:
    """Znajdz regiony nalezace do gracza."""
    regions = []
    state_data = state.get("state", state)
    for rid, region in state_data.get("regions", {}).items():
        if region.get("owner_id") == player_id:
            regions.append({"id": rid, **region})
    return regions


def find_enemy_regions(state: dict, player_id: str) -> list[dict]:
    """Znajdz regiony wroga."""
    regions = []
    state_data = state.get("state", state)
    for rid, region in state_data.get("regions", {}).items():
        owner = region.get("owner_id")
        if owner and owner != player_id:
            regions.append({"id": rid, **region})
    return regions


def find_all_regions(state: dict) -> list[dict]:
    """Zwroc wszystkie regiony."""
    state_data = state.get("state", state)
    return [{"id": rid, **r} for rid, r in state_data.get("regions", {}).items()]


def extract_player_id(state: dict) -> str | None:
    """Wyciagnij player_id z initial state (pierwszy gracz ktory jest nasz)."""
    state_data = state.get("state", state)
    players = state_data.get("players", {})
    # Wezmij pierwszy klucz (w meczu solo/tutorial jest jeden gracz)
    for pid, p in players.items():
        if not p.get("is_bot", False):
            return pid
    # Fallback - pierwszy gracz
    return next(iter(players), None)


async def recv_messages(ws, duration: float):
    """Odbieraj wiadomosci przez N sekund, loguj ciekawe."""
    end = time.time() + duration
    warnings = 0
    errors = 0
    eliminations = 0

    while time.time() < end:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=0.5)
            data = json.loads(msg)
            msg_type = data.get("type", "")

            if msg_type == "anticheat_warning":
                warnings += 1
                print(f"  [!] ANTICHEAT WARNING: {data.get('message')}")

            elif msg_type == "error":
                errors += 1
                fatal = data.get("fatal", False)
                print(f"  [{'!!!' if fatal else '!'}] ERROR: {data.get('message')}")
                if fatal:
                    return {"warnings": warnings, "errors": errors, "fatal": True}

            elif msg_type == "game_tick":
                events = data.get("events", [])
                for event in events:
                    if event.get("type") == "player_eliminated" and event.get("reason") == "cheating_detected":
                        eliminations += 1
                        print(f"  [!!!] PLAYER ELIMINATED (cheating): {event.get('player_id')}")
                    elif event.get("type") == "action_rejected":
                        pass  # Expected for invalid actions

        except TimeoutError:
            continue
        except websockets.ConnectionClosed:
            print("  [x] Polaczenie zamkniete przez serwer!")
            return {"warnings": warnings, "errors": errors, "fatal": True}

    return {"warnings": warnings, "errors": errors, "eliminations": eliminations, "fatal": False}


# ============================================================================
# Cheat Modes
# ============================================================================


async def mode_flood(ws, state, player_id):
    """
    ACTION FLOOD: Wyslij 50 akcji/tick przez 10 ticków.
    Anticheat powinien wykryc po 5 tickach (FLOOD_WINDOW).
    """
    print("\n" + "=" * 60)
    print("[FLOOD] Wysylanie 50 akcji/tick przez 10 tickow...")
    print("=" * 60)

    my_regions = find_player_regions(state, player_id)
    enemy_regions = find_enemy_regions(state, player_id)

    if not my_regions:
        print("  [!] Brak wlasnych regionow - trzeba najpierw wybrac stolice!")
        return

    source = my_regions[0]
    target = enemy_regions[0] if enemy_regions else find_all_regions(state)[0]

    for tick in range(10):
        print(f"  [tick {tick + 1}/10] Wysylam 50 ataków...")
        for _i in range(50):
            msg = json.dumps(
                {
                    "action": "attack",
                    "source_region_id": source["id"],
                    "target_region_id": target["id"],
                    "units": 1,
                    "unit_type": "infantry",
                }
            )
            await ws.send(msg)

        # Czekaj na tick
        result = await recv_messages(ws, TICK_INTERVAL)
        if result.get("fatal"):
            print("[FLOOD] Mecz anulowany lub polaczenie zamkniete!")
            return
        if result.get("warnings"):
            print(f"  -> Otrzymano {result['warnings']} ostrzezen anticheat!")

    # Czekaj na reakcje
    print("[FLOOD] Czekam na reakcje anticheat (5s)...")
    await recv_messages(ws, 5.0)


async def mode_timing(ws, state, player_id):
    """
    IMPOSSIBLE TIMING: Burst 100 akcji w <50ms.
    Anticheat powinien wykryc natychmiastowe serie.
    """
    print("\n" + "=" * 60)
    print("[TIMING] Burst 100 akcji bez przerwy...")
    print("=" * 60)

    my_regions = find_player_regions(state, player_id)
    enemy_regions = find_enemy_regions(state, player_id)

    if not my_regions:
        print("  [!] Brak wlasnych regionow!")
        return

    source = my_regions[0]
    target = enemy_regions[0] if enemy_regions else find_all_regions(state)[0]

    # Wyslij 100 akcji tak szybko jak to mozliwe
    start = time.time()
    for _i in range(100):
        msg = json.dumps(
            {
                "action": "attack",
                "source_region_id": source["id"],
                "target_region_id": target["id"],
                "units": 1,
                "unit_type": "infantry",
            }
        )
        await ws.send(msg)
    elapsed = time.time() - start
    print(f"  Wyslano 100 akcji w {elapsed * 1000:.1f}ms")

    print("[TIMING] Czekam na reakcje anticheat (5s)...")
    await recv_messages(ws, 5.0)


async def mode_pattern(ws, state, player_id):
    """
    REPETITIVE PATTERN: Powtorz identyczna sekwencje 8 akcji 5 razy.
    Anticheat powinien wykryc powtorzenie (prog = 3 razy).
    """
    print("\n" + "=" * 60)
    print("[PATTERN] Powtarzanie sekwencji 8 akcji 5x...")
    print("=" * 60)

    my_regions = find_player_regions(state, player_id)
    if not my_regions:
        print("  [!] Brak wlasnych regionow!")
        return

    source = my_regions[0]
    all_regions = find_all_regions(state)
    targets = [r for r in all_regions if r["id"] != source["id"]][:8]

    if len(targets) < 8:
        targets = (targets * 8)[:8]

    # Zdefiniuj sekwencje 8 akcji
    sequence = []
    for t in targets:
        sequence.append(
            json.dumps(
                {
                    "action": "attack",
                    "source_region_id": source["id"],
                    "target_region_id": t["id"],
                    "units": 1,
                    "unit_type": "infantry",
                }
            )
        )

    # Powtorz 5 razy
    for rep in range(5):
        print(f"  [powtorzenie {rep + 1}/5] Wysylam sekwencje 8 akcji...")
        for msg in sequence:
            await ws.send(msg)
        await asyncio.sleep(0.1)

    print("[PATTERN] Czekam na reakcje anticheat (5s)...")
    await recv_messages(ws, 5.0)


async def mode_fog(ws, state, player_id):
    """
    FOG OF WAR ABUSE: Atakuj regiony daleko od wlasnych (poza visibility).
    Anticheat powinien wykryc atak na niewidoczny region.
    """
    print("\n" + "=" * 60)
    print("[FOG] Atakowanie odleglych regionow poza zasiegiem widzenia...")
    print("=" * 60)

    my_regions = find_player_regions(state, player_id)
    all_regions = find_all_regions(state)

    if not my_regions:
        print("  [!] Brak wlasnych regionow!")
        return

    source = my_regions[0]

    # Znajdz regiony ktore NIE granicza z naszymi (daleko)
    my_region_ids = {r["id"] for r in my_regions}
    far_regions = [r for r in all_regions if r["id"] not in my_region_ids]

    # Atakuj 10 odleglych regionow
    count = 0
    for target in far_regions[:10]:
        msg = json.dumps(
            {
                "action": "attack",
                "source_region_id": source["id"],
                "target_region_id": target["id"],
                "units": 1,
                "unit_type": "infantry",
            }
        )
        await ws.send(msg)
        count += 1
        await asyncio.sleep(0.05)

    print(f"  Wyslano {count} ataków na odlegle regiony")

    print("[FOG] Czekam na reakcje anticheat (5s)...")
    await recv_messages(ws, 5.0)


async def mode_escalate(ws, state, player_id):
    """
    ESCALATE: Laczy wszystkie tryby zeby eskalowac score do CancelMatch.
    """
    print("\n" + "=" * 60)
    print("[ESCALATE] Lacze wszystkie cheaty - probuje eskalowac do anulowania meczu")
    print("=" * 60)

    for mode_fn in [mode_fog, mode_flood, mode_pattern, mode_timing]:
        try:
            await mode_fn(ws, state, player_id)
        except websockets.ConnectionClosed:
            print("\n[ESCALATE] Polaczenie zamkniete - anticheat zadziatal!")
            return
        await asyncio.sleep(1)

    print("[ESCALATE] Wszystkie tryby wykonane")


# ============================================================================
# Main
# ============================================================================

MODES = {
    "flood": mode_flood,
    "timing": mode_timing,
    "pattern": mode_pattern,
    "fog": mode_fog,
    "escalate": mode_escalate,
}


async def main(args):
    ws_url = args.ws_url.rstrip("/")

    try:
        ws, state = await connect(ws_url, args.match_id, args.token)
    except Exception as e:
        print(f"[!] Nie mozna polaczyc: {e}")
        sys.exit(1)

    player_id = extract_player_id(state)
    if not player_id:
        print("[!] Nie znaleziono player_id w stanie gry!")
        await ws.close()
        sys.exit(1)

    print(f"[+] Player ID: {player_id}")

    my_regions = find_player_regions(state, player_id)
    print(f"[+] Moje regiony: {len(my_regions)}")

    if not my_regions:
        print("[!] Brak regionow - upewnij sie ze wybrales stolice przed uruchomieniem skryptu!")
        await ws.close()
        sys.exit(1)

    if args.mode == "all":
        for name in ["flood", "timing", "pattern", "fog"]:
            print(f"\n{'#' * 60}")
            print(f"# Tryb: {name}")
            print(f"{'#' * 60}")
            try:
                await MODES[name](ws, state, player_id)
            except websockets.ConnectionClosed:
                print(f"\n[x] Polaczenie zamkniete po trybie '{name}'")
                return
            await asyncio.sleep(2)
    else:
        try:
            await MODES[args.mode](ws, state, player_id)
        except websockets.ConnectionClosed:
            print("\n[x] Polaczenie zamkniete - anticheat zadziatal!")
            return

    print("\n" + "=" * 60)
    print("KONIEC TESTU")
    print("Sprawdz logi gateway (docker compose logs gateway) ")
    print("aby zobaczyc komunikaty anticheat:")
    print("  grep 'ANTICHEAT' lub 'anticheat'")
    print("=" * 60)

    await ws.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="MapLord Anti-Cheat Test - symulacja cheaterskich zachowan",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Przyklady:
  # Testuj flood na lokalnym meczu
  python scripts/cheat_simulator.py --token eyJ... --match-id abc123 --mode flood

  # Testuj wszystko
  python scripts/cheat_simulator.py --token eyJ... --match-id abc123 --mode all

  # Probuj eskalowac do anulowania meczu
  python scripts/cheat_simulator.py --token eyJ... --match-id abc123 --mode escalate
        """,
    )
    parser.add_argument("--token", required=True, help="JWT access token")
    parser.add_argument("--match-id", required=True, help="Match ID (z URL /game/MATCH_ID)")
    parser.add_argument(
        "--mode", default="all", choices=list(MODES.keys()) + ["all"], help="Tryb cheata (default: all)"
    )
    parser.add_argument("--ws-url", default=DEFAULT_WS_URL, help=f"WebSocket URL (default: {DEFAULT_WS_URL})")

    args = parser.parse_args()
    asyncio.run(main(args))
