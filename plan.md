# Plan: Migracja z MapLibre GL na Pixi.js (WebGL Canvas)

## Dlaczego Pixi.js a nie raw Canvas 2D

| Kryterium | Pixi.js | Raw Canvas 2D |
|-----------|---------|---------------|
| Rendering | WebGL (GPU) | CPU |
| Wydajność przy 200+ regionach | Doskonała | Problematyczna |
| Tekstury/gradienty/shadery | Wbudowane (filters, shaders) | Ręczna implementacja |
| Hit-testing (klik na prowincję) | `hitArea` + polygon | Ręczny point-in-polygon |
| Animacje | Ticker + tweeny | Ręczny rAF (już macie) |
| Zoom/pan | `@pixi/viewport` plugin | Ręczna implementacja |
| Rozmiar | ~150KB gzip | 0KB |
| Czas implementacji | ~3-4 tygodnie | ~6-8 tygodni |

**Pixi.js v8** to najlepszy kandydat — lekki WebGL/WebGPU renderer z pełną kontrolą nad kształtami, bez narzutu geo-mapping.

## Zakres zmian

### Co zostaje bez zmian
- Cała logika gry (WebSocket, state management, hooks)
- Backend (Django, PostGIS, tile API — ale format danych się zmieni)
- Rust gateway
- System animacji (rAF loop, path computation, easing) — do przeniesienia
- `animationConfig.ts`, `gameAssets.ts`, `gameTravel.js` — bez zmian
- Props interface `GameMapProps` — minimalne zmiany
- Parent component `app/game/[matchId]/page.tsx` — minimalne zmiany

### Co się zmienia

#### Faza 1: Nowy format danych prowincji (~3 dni)
- **Nowy endpoint API**: `/api/v1/geo/regions/shapes/?match_id={id}`
  - Zwraca JSON z prowincjami: `{ id, polygon: [[x,y]...], centroid: [x,y], neighbors: [id...] }`
  - Współrzędne w **pixel space** (nie lat/lng) — bo odchodzimy od geo
  - Alternatywnie: plik JSON/SVG z definicjami kształtów prowincji
- **Nowy model danych**: `ProvinceShape` — kształt niezależny od real-world geo
  - Opcja A: Edytor map w adminie Django (SVG → polygon coordinates)
  - Opcja B: Proceduralna generacja (Voronoi, hex grid)
  - Opcja C: Ręcznie rysowane pliki JSON/SVG
- **Migracja danych**: Skrypt konwertujący obecne PostGIS regiony na format pixel-space (dla zachowania kompatybilności wstecznej)

#### Faza 2: Core renderer Pixi.js (~5 dni)
- **Nowy komponent**: `components/map/GameCanvas.tsx`
- **Pixi Application** osadzony w React via `useRef` + `useEffect`
- **Viewport** (`@pixi/viewport`): zoom, pan, inercja, granice
- **ProvinceRenderer** class:
  - `Graphics` obiekt per prowincja (polygon fill + stroke)
  - Dynamiczny kolor wypełnienia (owner color)
  - Hover effect (brighten filter)
  - Selection states (outline colors/widths)
  - **Hit area** per polygon (automatyczne klik/hover detection)
  - Wsparcie dla **tekstur**: fill pattern, gradient, custom sprite fill
  - Wsparcie dla **shaderów**: fog of war, terrain look, animowane granice
- **Label layer**: `BitmapText` lub `Text` per prowincja (unit count)
- **Marker layer**: Sprites dla capitals, buildings (zastępuje DOM markery)

#### Faza 3: System animacji na Pixi (~4 dni)
- **Port rAF loop** → Pixi `Ticker`
- **Trail rendering**: `Graphics` linie z blur filter (zastępuje GeoJSON line layer)
- **Particle dots**: `ParticleContainer` (szybsze niż circle layer)
- **Unit icons**: `Sprite` z rotacją, scale breathing, fade
- **Impact flashes**: `Graphics` circles z alpha animation
- **Defend pulses**: `Graphics` expanding rings
- **Unit change labels**: `Text` z tween (drift + fade)
- **Nuke blackout**: `Graphics` overlay z alpha fade na affected regionach

#### Faza 4: Efekty ability i cosmetics (~2 dni)
- **Effect overlay**: Semi-transparent `Graphics` fill na affected regionach
- **Effect icons**: `Sprite` at centroid
- **Effect borders**: Dashed line (Pixi `Graphics` z dash pattern)
- **Cosmetics system**: Per-player texture/shader overrides
  - Custom province fill textures
  - Custom trail shaders
  - Custom impact VFX

#### Faza 5: Customizacja prowincji — nowe możliwości (~3 dni)
- **Edytor kształtów** (opcjonalny, w przyszłości):
  - SVG import → polygon conversion
  - Proceduralna generacja (Voronoi z seed)
  - Hex grid generator
- **Tekstury prowincji**:
  - Per-biome fill (las, pustynia, woda, góry)
  - Animated borders (pulsujące granice)
  - Fog of war (shader-based, per-region visibility)
- **Custom mapy**:
  - Fantasy map support (nie real-world)
  - Proceduralne mapy (Voronoi/hex)
  - Import z pliku (SVG/JSON)

#### Faza 6: Integracja i cleanup (~2 dni)
- Podłączenie `GameCanvas` do `app/game/[matchId]/page.tsx`
- Aktualizacja propsów (usunięcie `tilesUrl`, dodanie `provinceShapes`)
- Testy wydajności (60fps z 200+ prowincjami)
- Usunięcie `maplibre-gl` z dependencies
- Usunięcie starego `GameMap.tsx`

#### Faza 7: Edytor map (Map Creator) (~5-7 dni)
Wizualny edytor do tworzenia custom map w przeglądarce (Pixi.js canvas).

- **Nowy model Django**: `CustomMap`
  - `author` FK → User (twórca mapy)
  - `name`, `description`, `thumbnail` (auto-generowany screenshot)
  - `map_data` JSON — polygon definitions, centroids, neighbors, metadata
  - `is_public` bool — widoczna dla innych graczy
  - `is_verified` bool — zatwierdzona przez admina (opcjonalnie)
  - `player_count_min`, `player_count_max` — ile graczy obsługuje
  - `region_count` int — liczba prowincji
  - `tags` — kategoryzacja (fantasy, historical, procedural, etc.)

- **Narzędzia edytora** (frontend, Pixi.js canvas):
  - **Rysowanie polygonów**: klik-po-kliku tworzenie kształtów prowincji
  - **Edycja wierzchołków**: przeciąganie punktów, dodawanie/usuwanie
  - **Auto-snap**: automatyczne łączenie krawędzi sąsiednich prowincji
  - **Auto-neighbors**: wykrywanie sąsiedztwa na podstawie shared edges
  - **Auto-centroid**: obliczanie centroidu z polygonu
  - **Wypełnienie**: wybór koloru/tekstury tła per prowincja (biome)
  - **Import SVG**: wczytanie gotowej mapy i podział na prowincje
  - **Proceduralna generacja**:
    - Voronoi diagram z seed (losowy podział na N prowincji)
    - Hex grid (regularna siatka heksagonalna)
    - Parametry: liczba prowincji, rozmiar canvasu, seed
  - **Podgląd na żywo**: preview jak mapa wygląda w grze
  - **Walidacja**: sprawdzenie spójności grafu (czy wszystkie prowincje są osiągalne)
  - **Eksport/import JSON**: udostępnianie map

- **API endpoints**:
  - `POST /api/v1/maps/` — tworzenie mapy
  - `GET /api/v1/maps/` — lista map (publiczne + własne)
  - `GET /api/v1/maps/{id}/` — szczegóły mapy z map_data
  - `PUT /api/v1/maps/{id}/` — edycja
  - `DELETE /api/v1/maps/{id}/` — usunięcie
  - `POST /api/v1/maps/{id}/publish/` — publikacja
  - `GET /api/v1/maps/community/` — przeglądarka map społeczności

- **Frontend strony**:
  - `/maps/create` — edytor map
  - `/maps/browse` — przeglądarka map (grid z thumbnails)
  - `/maps/{id}` — podgląd mapy ze statystykami

#### Faza 8: Kreator rozgrywki (Match Creator) (~4-5 dni)
Panel do tworzenia custom matchy z własnymi zasadami — rozszerzenie obecnego Lobby.

- **Rozszerzenie modelu `Lobby`** (lub nowy `CustomLobby`):
  - `custom_settings` JSON — override'y zasad gry (nadpisuje GameMode defaults)
  - `custom_map` FK → CustomMap (opcjonalnie, zamiast MapConfig)
  - `is_public` bool — czy lobby widoczne w przeglądarce
  - `password` — opcjonalne hasło do dołączenia
  - `lobby_name` — nazwa wyświetlana na liście

- **Dostępne ustawienia do customizacji** (UI formularza):
  - **Mapa**: wybór z MapConfig (real-world) lub CustomMap (community)
  - **Gracze**: min/max liczba graczy
  - **Ekonomia**: starting_units, starting_energy, base_energy_per_tick, region_energy_per_tick, base_unit_generation_rate, capital_generation_bonus
  - **Walka**: attacker_advantage, defender_advantage, combat_randomness
  - **Timing**: tick_interval_ms, capital_selection_time_seconds, match_duration_limit_minutes
  - **Jednostki**: włączanie/wyłączanie typów jednostek, modyfikacja statów
  - **Budynki**: włączanie/wyłączanie typów budynków, modyfikacja kosztów
  - **Ability**: włączanie/wyłączanie ability, modyfikacja cooldownów/kosztów
  - **Presets**: zapisywanie ulubionych zestawów zasad jako szablon

- **Flow tworzenia rozgrywki**:
  1. Gracz otwiera kreator → wybiera mapę → konfiguruje zasady
  2. Tworzy lobby (publiczne/prywatne)
  3. Inni gracze dołączają (przeglądarka lobby lub link/kod)
  4. Host startuje mecz → `custom_settings` merge z GameMode defaults → `settings_snapshot`
  5. Rust gateway ładuje `settings_snapshot` jak dotychczas (zero zmian w gateway)

- **Integracja z istniejącym systemem**:
  - `settings_snapshot` już obsługuje dowolne parametry — kreator tylko je ustawia
  - `_do_try_match()` w matchmaking już tworzy snapshot — dodajemy merge z `custom_settings`
  - Gateway nie wymaga zmian — czyta `settings_snapshot` generycznie

- **Frontend strony**:
  - `/play/create` — kreator rozgrywki (formularz + preview)
  - `/play/browse` — przeglądarka lobby (lista publicznych gier)
  - `/play/lobby/{id}` — lobby z czatem i listą graczy

#### Faza 9: Sandbox Mode (~3-4 dni)
Tryb sandbox do testowania, eksperymentowania i nauki — single-player z edycją zasad w locie.

- **Nowy GameMode**: `sandbox` (specjalny tryb):
  - `is_sandbox: true` flag w modelu GameMode
  - Brak ELO, brak statystyk, brak rankingu
  - Brak limitu czasu
  - Tylko 1 gracz (+ opcjonalni AI/boty w przyszłości)

- **Sandbox-specific features**:
  - **God mode panel** (React sidebar):
    - Zmiana właściciela dowolnej prowincji (klik → dropdown gracza)
    - Dodawanie/usuwanie jednostek na prowincji
    - Teleport jednostek
    - Zmiana energii gracza
    - Natychmiastowe budowanie (skip build time)
    - Trigger ability na dowolnej prowincji
    - Spawn neutralnych jednostek
  - **Rules editor w locie** (hot-reload):
    - Zmiana parametrów gry bez restartu meczu
    - Slider'y na live: tick_interval, combat_randomness, generation_rate
    - Rust gateway obsługuje `update_settings` WebSocket message
    - Nowa wiadomość WS: `{ type: "sandbox_update_settings", settings: {...} }`
  - **Timeline controls**:
    - Pauza/resume gry (stop ticker w gateway)
    - Speed up (zmiana tick_interval w locie: 1x, 2x, 5x, 10x)
    - Step-by-step (jeden tick na raz)
  - **Debug overlay** (opcjonalny):
    - Wyświetlanie neighbor graph jako linie
    - Numery prowincji
    - Wartości obrony/ataku
    - Zasięgi ability

- **Zmiany w Rust gateway** (minimalne):
  - Nowy handler WS: `sandbox_update_settings` — aktualizuje `GameSettings` w locie
  - Nowy handler WS: `sandbox_command` — god mode actions (set_owner, add_units, etc.)
  - Flag `is_sandbox` w match data — wyłącza anti-cheat, ELO
  - `sandbox_pause` / `sandbox_resume` — kontrola tickera

- **Frontend**:
  - `/sandbox` — lista sandbox sesji + "New Sandbox"
  - `/sandbox/{id}` — sandbox view = GameCanvas + God Mode Panel + Rules Editor

#### Faza 10: System craftowania i customizacji (~5-7 dni)
Pełny system craftingu kosmetycznych i gameplay itemów. Gracz zbiera materiały z gier i tworzy unikalne przedmioty.

##### Materiały (zasoby do craftowania)
Zdobywane z rozgrywek — im lepszy wynik, tym lepsze materiały.

| Materiał | Źródło | Rzadkość |
|----------|--------|----------|
| Iron Shard | Wygranie walki (atak/obrona) | Common |
| Gold Dust | Zdobycie prowincji | Common |
| Crystal Fragment | Wygranie meczu | Uncommon |
| Ancient Scroll | Top 1 w meczu 4-osobowym | Rare |
| Void Essence | Streak 5+ wygranych z rzędu | Epic |
| Dragon Core | Wygrana bez utraty kapitału | Legendary |
| Star Metal | Zdobycie 90%+ mapy przed końcem | Legendary |
| Biome Seed | Ukończenie sandbox challenge | Uncommon |
| War Paint | Uczestnictwo w 10 meczach | Common |
| Titan Rune | Zniszczenie 100+ jednostek w jednym meczu | Rare |

##### Craftowalane itemy — PEŁNA LISTA

**A. Kosmetyki prowincji (Province Skins)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Lava Province | Prowincje wyglądają jak lawa | 3x Iron Shard, 1x Crystal Fragment | Animowana tekstura lawy z glow |
| Ice Province | Lodowe prowincje | 3x Gold Dust, 1x Crystal Fragment | Tekstura lodu z shimmer shader |
| Forest Province | Leśne prowincje | 2x Biome Seed, 2x Gold Dust | Drzewa i trawa jako fill pattern |
| Desert Province | Pustynne prowincje | 2x Biome Seed, 2x Iron Shard | Piaskowa tekstura z falami |
| Void Province | Ciemne, kosmiczne prowincje | 2x Void Essence, 1x Dragon Core | Animowany shader gwiazd i mgławic |
| Neon Province | Cyberpunkowe prowincje | 3x Crystal Fragment, 1x Void Essence | Neonowe kontury i grid pattern |
| Pixel Province | Retro pixel-art styl | 5x War Paint, 1x Ancient Scroll | Pixelated fill z 8-bit kolorami |
| Watercolor Province | Akwarelowy styl | 3x War Paint, 2x Biome Seed | Soft edges, watercolor bleed shader |
| Marble Province | Marmurowe prowincje | 5x Iron Shard, 1x Titan Rune | Noise-based marble texture |
| Corrupted Province | Glitch/corrupted look | 1x Star Metal, 2x Void Essence | Glitch shader z distortion |

**B. Obramowania prowincji (Border Styles)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Golden Borders | Złote obramowania | 5x Gold Dust, 1x Crystal Fragment | Gradient gold stroke |
| Fire Borders | Płonące krawędzie | 3x Iron Shard, 1x Titan Rune | Animowany shader ognia na krawędziach |
| Electric Borders | Elektryczne granice | 2x Crystal Fragment, 1x Void Essence | Pulsujące iskry wzdłuż border |
| Shadow Borders | Cienie pod granicami | 3x War Paint, 1x Ancient Scroll | Drop shadow + blur na borderach |
| Rainbow Borders | Tęczowe granice | 3x Crystal Fragment, 1x Dragon Core | Hue-shifting animated border |
| Runic Borders | Runy wzdłuż granic | 2x Ancient Scroll, 1x Titan Rune | Symbol pattern na linii |
| Thorns Borders | Kolczaste granice | 4x Iron Shard, 1x Biome Seed | Spike'i na krawędziach polygonów |
| Dotted Borders | Kropkowane granice | 3x War Paint | Animated dotted line |

**C. Animacje troop (Trail VFX)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Fire Trail | Ognisty ślad za jednostkami | 2x Iron Shard, 1x Titan Rune | Particle fire trail + glow |
| Ice Trail | Lodowy ślad | 3x Crystal Fragment | Blue particles + frost shader |
| Lightning Trail | Błyskawice za jednostkami | 2x Crystal Fragment, 1x Void Essence | Jagged line + flash particles |
| Rainbow Trail | Tęczowy ślad | 3x War Paint, 1x Dragon Core | Hue-shifting trail line |
| Smoke Trail | Dymny ślad | 3x Iron Shard, 1x War Paint | Gray particle cloud z fade |
| Star Trail | Gwiazdki za jednostkami | 2x Gold Dust, 1x Star Metal | Star-shaped particles z twinkle |
| Blood Trail | Krwawy ślad (attack only) | 3x Iron Shard, 1x Titan Rune | Red droplet particles |
| Void Trail | Kosmiczny ślad | 2x Void Essence, 1x Star Metal | Purple/black particles z distortion |
| Flower Trail | Kwiatowy ślad (move only) | 3x Biome Seed, 1x Crystal Fragment | Flower petal particles |
| Pixel Trail | Retro pixel ślad | 3x War Paint, 1x Ancient Scroll | Pixelated square particles |

**D. Animacje impact (Attack/Arrive VFX)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Explosion Impact | Duża eksplozja | 3x Iron Shard, 1x Titan Rune | Multi-ring fire explosion |
| Shockwave Impact | Fala uderzeniowa | 2x Crystal Fragment, 1x Void Essence | Expanding distortion ring shader |
| Lightning Strike | Uderzenie pioruna | 2x Crystal Fragment, 1x Dragon Core | Jagged bolt + flash |
| Meteor Impact | Spadający meteor | 1x Star Metal, 2x Iron Shard | Arc trajectory + crater ring |
| Portal Impact | Portal otwierający się | 2x Void Essence, 1x Ancient Scroll | Spiral + particle vortex |
| Bloom Impact | Rozkwitanie kwiatów | 3x Biome Seed, 1x Crystal Fragment | Expanding flower pattern |
| Glitch Impact | Glitch/error efekt | 2x Void Essence, 1x Star Metal | Screen-tear + static |
| Holy Impact | Świetlisty uderzenie | 2x Gold Dust, 1x Dragon Core | Light beams + golden rings |

**E. Ikony jednostek (Unit Skins)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Steampunk Fighter | Steampunkowy samolot | 3x Iron Shard, 1x Ancient Scroll | Custom sprite + steam particles |
| Ghost Ship | Widmowy okręt | 2x Void Essence, 1x Crystal Fragment | Translucent sprite z glow |
| Mech Tank | Mechaniczny czołg | 3x Iron Shard, 1x Titan Rune | Animated mech sprite |
| Skeleton Infantry | Szkieletowa piechota | 2x Ancient Scroll, 1x Void Essence | Bone sprite z green glow |
| Dragon Fighter | Smok zamiast samolotu | 1x Dragon Core, 2x Crystal Fragment | Dragon sprite z fire particles |
| Submarine Ship | Podwodny okręt | 3x Iron Shard, 1x Crystal Fragment | Submerging animation |
| Golem Tank | Golem zamiast czołgu | 2x Titan Rune, 1x Biome Seed | Stone golem sprite |
| Robot Infantry | Robot piechota | 3x Iron Shard, 1x Crystal Fragment | Metallic sprite z sparks |

**F. Ikony budynków (Building Skins)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Crystal Fortress | Kryształowa forteca | 3x Crystal Fragment, 1x Dragon Core | Shimmering crystal sprite |
| Volcano Factory | Wulkaniczna fabryka | 3x Iron Shard, 1x Titan Rune | Smoke + lava glow |
| Tree Barracks | Drzewo-koszary | 2x Biome Seed, 1x Ancient Scroll | Living tree sprite |
| Cloud Tower | Wieża w chmurach | 2x Gold Dust, 1x Void Essence | Floating cloud particles |
| Bone Outpost | Kostny posterunek | 2x Ancient Scroll, 1x Void Essence | Skull + bone sprite |
| Tech Lab | Laboratorium hi-tech | 3x Crystal Fragment, 1x Star Metal | Hologram + scan line shader |

**G. Kapitał (Capital Skins)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Golden Crown | Złota korona | 5x Gold Dust, 1x Dragon Core | Animated crown sprite z sparkle |
| Dark Throne | Mroczny tron | 2x Void Essence, 1x Star Metal | Dark aura shader + floating particles |
| Crystal Spire | Kryształowa iglica | 3x Crystal Fragment, 1x Dragon Core | Tall crystal z prismatic glow |
| War Banner | Bojowy sztandar | 3x War Paint, 1x Titan Rune | Animated flag sprite |
| Ancient Obelisk | Starożytny obelisk | 3x Ancient Scroll, 1x Star Metal | Runic glow + floating runes |
| World Tree | Drzewo świata | 3x Biome Seed, 1x Dragon Core | Massive tree z particle leaves |
| Skull Pyre | Stos czaszek | 2x Titan Rune, 1x Void Essence | Fire + floating embers |

**H. Efekty ability (Ability VFX)**
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Frost Shield | Lodowa tarcza | 2x Crystal Fragment, 1x Biome Seed | Ice shader overlay zamiast domyślnego blue |
| Plague Virus | Zaraza | 2x Void Essence, 1x Ancient Scroll | Skull particles zamiast zielonego tint |
| Solar Nuke | Słoneczny nuke | 1x Star Metal, 1x Dragon Core | White/gold explosion zamiast czerwonej |
| Shadow Sub | Cienisty okręt podwodny | 2x Void Essence, 1x Titan Rune | Dark mist zamiast purple glow |
| Blood Conscription | Krwawa mobilizacja | 2x Titan Rune, 1x War Paint | Red pulse zamiast amber glow |

**I. Tła map (Map Backgrounds)** — widoczne pod prowincjami
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Ocean Floor | Dno oceanu | 3x Biome Seed, 1x Crystal Fragment | Animated water caustics shader |
| Star Field | Pole gwiazd | 2x Void Essence, 1x Star Metal | Parallax scrolling stars |
| Parchment | Stary pergamin | 3x Ancient Scroll | Aged paper texture z burned edges |
| Grid Paper | Papier w kratkę | 5x War Paint | Minimalistyczny grid |
| Lava Field | Pole lawy | 3x Iron Shard, 1x Titan Rune | Animated lava flow pod mapą |
| Cloud Sky | Niebo z chmurami | 3x Gold Dust, 1x Biome Seed | Moving cloud layer |

**J. Efekty zwycięstwa (Victory Animations)** — po wygraniu meczu
| Item | Opis | Materiały | Efekt |
|------|------|-----------|-------|
| Fireworks | Fajerwerki | 3x Gold Dust, 1x Crystal Fragment | Particle fireworks nad mapą |
| Confetti Rain | Deszcz konfetti | 3x War Paint, 1x Gold Dust | Falling confetti particles |
| Lightning Storm | Burza piorunów | 2x Crystal Fragment, 1x Titan Rune | Screen flash + bolt animations |
| Black Hole | Czarna dziura | 2x Void Essence, 1x Star Metal | Imploding spiral + distortion |
| Golden Rain | Złoty deszcz | 5x Gold Dust, 1x Dragon Core | Falling gold particle shower |
| Earthquake | Trzęsienie ziemi | 2x Titan Rune, 1x Iron Shard | Screen shake + crack lines |

##### Modele Django (apps/shop/ rozszerzenie)

```python
class Material(models.Model):
    slug = models.SlugField(unique=True)        # "iron_shard"
    name = models.CharField(max_length=100)
    description = models.TextField()
    icon = models.ImageField()
    rarity = models.CharField(choices=RARITY_CHOICES)  # common/uncommon/rare/epic/legendary

class MaterialDrop(models.Model):
    """Defines how materials are earned from gameplay"""
    material = models.ForeignKey(Material)
    trigger = models.CharField(choices=TRIGGER_CHOICES)  # "win_battle", "win_match", "capture_region", etc.
    amount_min = models.IntegerField(default=1)
    amount_max = models.IntegerField(default=1)
    probability = models.FloatField(default=1.0)        # 0.0-1.0 drop chance
    conditions = models.JSONField(default=dict)          # {"min_players": 4, "streak": 5}

class PlayerMaterial(models.Model):
    """Player's material inventory"""
    user = models.ForeignKey(User)
    material = models.ForeignKey(Material)
    amount = models.IntegerField(default=0)

class CraftableItem(models.Model):
    slug = models.SlugField(unique=True)        # "lava_province"
    name = models.CharField(max_length=100)
    description = models.TextField()
    category = models.CharField(choices=CATEGORY_CHOICES)  # province_skin, border, trail, impact, unit_skin, etc.
    icon = models.ImageField()
    rarity = models.CharField(choices=RARITY_CHOICES)
    cosmetic_data = models.JSONField()           # {"texture_url": "...", "shader": "lava", "params": {...}}

class CraftRecipe(models.Model):
    item = models.ForeignKey(CraftableItem)
    material = models.ForeignKey(Material)
    amount = models.IntegerField()

class PlayerItem(models.Model):
    """Player's crafted item inventory"""
    user = models.ForeignKey(User)
    item = models.ForeignKey(CraftableItem)
    crafted_at = models.DateTimeField(auto_now_add=True)
    is_equipped = models.BooleanField(default=False)
    equipped_slot = models.CharField(null=True)  # "province_skin", "trail_vfx", etc.
```

##### Integracja z istniejącym systemem cosmetics

Obecny system już obsługuje cosmetics per-player (`cosmetic_snapshot` w MatchPlayer, `playerCosmetics` w GameMap). Crafted itemy po prostu wypełniają te sloty:

```
PlayerItem (equipped) → cosmetic_snapshot przy tworzeniu meczu → settings_snapshot → Rust gateway → frontend animationConfig resolver
```

Zero zmian w Rust gateway — cosmetics są już przezroczyste dla engine'u.

## Nowa architektura komponentu

```
GameCanvas.tsx
├── PixiApp (useRef)
│   ├── Viewport (@pixi/viewport)
│   │   ├── ProvinceContainer
│   │   │   ├── ProvinceGraphics[] (fill + stroke per region)
│   │   │   ├── ProvinceTextures[] (optional custom fills)
│   │   │   └── ProvinceFogOfWar (shader overlay)
│   │   ├── LabelContainer
│   │   │   ├── UnitCountText[] (BitmapText per region)
│   │   │   └── RegionNameText[] (optional)
│   │   ├── MarkerContainer
│   │   │   ├── CapitalSprites[]
│   │   │   └── BuildingSprites[]
│   │   ├── AnimationContainer
│   │   │   ├── TrailGraphics[] (line trails)
│   │   │   ├── ParticleContainer (trail dots)
│   │   │   ├── UnitSprites[] (moving icons)
│   │   │   ├── PulseGraphics[] (defend rings)
│   │   │   └── ImpactGraphics[] (flash effects)
│   │   └── EffectContainer
│   │       ├── EffectOverlays[] (ability tints)
│   │       └── EffectIcons[] (ability sprites)
│   └── UIOverlay (React portal for HTML tooltips if needed)
```

## Porównanie bundle size

| Obecny | Po migracji |
|--------|-------------|
| maplibre-gl: ~220KB gzip | pixi.js v8: ~150KB gzip |
| - | @pixi/viewport: ~15KB gzip |
| **220KB** | **~165KB** |

## Zyski z migracji

1. **Pełna kontrola nad kształtami** — dowolne polygony, nie ograniczone do real-world geo
2. **Custom tekstury** — per-biome, per-player fills, animated patterns
3. **Shadery** — fog of war, terrain effects, glow, distortion
4. **Fantasy/proceduralne mapy** — Voronoi, hex, custom layouts
5. **Mniejszy bundle** — ~55KB oszczędności
6. **Lepsza wydajność animacji** — ParticleContainer, GPU sprites
7. **Brak zależności od tile servera** — regiony ładowane jako JSON, nie MVT
8. **Prostszy deployment** — nie trzeba serwować vector tiles

## Ryzyka

1. **Utrata smooth pan/zoom** — `@pixi/viewport` jest dobry, ale MapLibre ma lata dopracowania
2. **Regression bugs** — 1920 linii kodu do przepisania
3. **Czas** — ~3-4 tygodnie robocze
4. **Label collision** — MapLibre ma wbudowany symbol placement, w Pixi trzeba ręcznie
5. **Accessibility** — Canvas jest mniej dostępny niż DOM/SVG

## Rekomendacja

**Tak, migracja ma sens** przy założeniu pełnej customizacji prowincji. Pixi.js v8 jest najlepszym kandydatem:
- WebGL/WebGPU rendering (wydajność)
- Pełna kontrola nad renderowaniem (tekstury, shadery, custom kształty)
- Mniejszy bundle niż MapLibre
- Dojrzały ekosystem (viewport, particles, filters)
- Obecny system animacji (rAF, path computation, easing) przenosi się prawie 1:1

Sugerowana kolejność: Faza 2 → 3 → 1 → 4 → 6 → 5 (core renderer najpierw, potem animacje, potem nowe dane, efekty, integracja, i na końcu nowe features customizacji).
