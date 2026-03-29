"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Code,
  Globe,
  Key,
  Lock,
  Shield,
  Webhook,
} from "lucide-react";
import Link from "next/link";

// ── Helpers ───────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-1 font-display text-xl text-zinc-50">{children}</h2>;
}

function SectionDescription({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-6 text-slate-400">{children}</p>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[24px] border border-white/10 bg-slate-950/55 backdrop-blur-xl ${className}`}>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-white/8 bg-black/40 p-4 font-mono text-sm leading-6 text-slate-300">
      <code>{children}</code>
    </pre>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  if (method === "GET") {
    return (
      <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
        GET
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-300">
      POST
    </span>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  return (
    <span className="shrink-0 rounded-md border border-slate-700/60 bg-slate-800/60 px-2 py-0.5 font-mono text-[10px] text-slate-400">
      {scope}
    </span>
  );
}

function EndpointRow({
  method,
  path,
  scope,
  description,
}: {
  method: "GET" | "POST";
  path: string;
  scope: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-white/5 px-5 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
      <MethodBadge method={method} />
      <code className="min-w-0 flex-1 font-mono text-xs text-slate-200 sm:text-sm">{path}</code>
      <ScopeBadge scope={scope} />
      <span className="text-xs text-slate-500 sm:w-48 sm:shrink-0 sm:text-right">{description}</span>
    </div>
  );
}

function ErrorRow({ code, name, description }: { code: number; name: string; description: string }) {
  const colorClass =
    code >= 500
      ? "text-red-300"
      : code === 429
        ? "text-orange-300"
        : code >= 400
          ? "text-amber-300"
          : "text-emerald-300";

  return (
    <div className="flex flex-col gap-1 border-t border-white/5 px-5 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-6">
      <span className={`w-12 shrink-0 font-mono text-base font-bold ${colorClass}`}>{code}</span>
      <span className="w-40 shrink-0 font-mono text-xs text-slate-300">{name}</span>
      <span className="text-sm text-slate-500">{description}</span>
    </div>
  );
}

function StepItem({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/10 font-display text-sm text-cyan-200">
        {step}
      </div>
      <div className="pt-0.5 text-sm leading-6 text-slate-300">{children}</div>
    </div>
  );
}

function ScopeRow({ scope, description, oauth }: { scope: string; description: string; oauth?: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-t border-white/5 px-5 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-6">
      <code className="w-48 shrink-0 font-mono text-xs text-cyan-200">{scope}</code>
      <span className="flex-1 text-sm text-slate-400">{description}</span>
      {oauth && (
        <span className="shrink-0 rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
          OAuth2
        </span>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function DocsPage() {
  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <Link
          href="/developers"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-cyan-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Powrot do portalu deweloperskiego
        </Link>

        <div className="mt-4">
          <SectionLabel>Portal Deweloperski</SectionLabel>
          <h1 className="mt-2 font-display text-3xl text-zinc-50">Dokumentacja API</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            Kompletny przewodnik po integracji z Zelqor API. Znajdziesz tu informacje o uwierzytelnianiu, dostepnych
            endpointach, OAuth2, webhookach i obsludze bledow.
          </p>
        </div>

        {/* Quick nav */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            { href: "#getting-started", label: "Pierwsze kroki" },
            { href: "#auth", label: "Uwierzytelnianie" },
            { href: "#scopes", label: "Uprawnienia" },
            { href: "#endpoints", label: "Endpointy" },
            { href: "#oauth2", label: "OAuth2" },
            { href: "#webhooks", label: "Webhooki" },
            { href: "#errors", label: "Kody bledow" },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-cyan-300/30 hover:text-cyan-200"
            >
              {label}
              <ChevronRight className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>

      {/* ── Section 1: Pierwsze kroki ──────────────────────── */}
      <section id="getting-started" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <BookOpen className="h-4.5 w-4.5 h-[18px] w-[18px] text-cyan-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 1</SectionLabel>
            <SectionTitle>Pierwsze kroki</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          Aby rozpoczac integracje z Zelqor API, wykonaj trzy kroki: utworz aplikacje w portalu deweloperskim, pobierz
          klucz API, a nastepnie wykonaj pierwsze zapytanie.
        </SectionDescription>

        <div className="space-y-3">
          <StepItem step={1}>
            <strong className="text-zinc-100">Utworz aplikacje</strong> — przejdz do{" "}
            <Link href="/developers" className="text-cyan-300 hover:underline">
              portalu deweloperskiego
            </Link>{" "}
            i kliknij &ldquo;Utworz aplikacje&rdquo;. Podaj nazwe i opis swojej integracji.
          </StepItem>
          <StepItem step={2}>
            <strong className="text-zinc-100">Pobierz klucz API</strong> — po utworzeniu aplikacji przejdz do jej
            szczegolów i wygeneruj klucz API w sekcji &ldquo;Klucze API&rdquo;. Klucz bedzie widoczny tylko raz —
            zachowaj go bezpiecznie.
          </StepItem>
          <StepItem step={3}>
            <strong className="text-zinc-100">Wykonaj pierwsze zapytanie</strong> — uzywaj nagłowka{" "}
            <code className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-xs text-cyan-200">X-API-Key</code> we
            wszystkich zapytaniach do publicznych endpointow.
          </StepItem>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-slate-500" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Base URL</span>
            </div>
            <code className="mt-1 block font-mono text-sm text-cyan-200">https://zelqor.gg/api/v1/public/</code>
          </div>
          <div className="px-5 py-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Przykladowe zapytanie (curl)
            </div>
            <CodeBlock>{`curl -X GET https://zelqor.gg/api/v1/public/leaderboard/ \\
  -H "X-API-Key: ml_twoj_klucz_api" \\
  -H "Accept: application/json"`}</CodeBlock>
          </div>
        </Card>
      </section>

      {/* ── Section 2: Uwierzytelnianie ────────────────────── */}
      <section id="auth" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <Key className="h-[18px] w-[18px] text-amber-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 2</SectionLabel>
            <SectionTitle>Uwierzytelnianie</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          Zelqor API obsluguje dwie metody uwierzytelniania: klucze API do endpointow publicznych oraz OAuth2 do
          endpointow wymagajacych kontekstu uzytkownika.
        </SectionDescription>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-300" />
              <span className="font-display text-sm text-zinc-100">Klucz API</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Do publicznych endpointow. Dodaj nagłowek{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-[11px] text-cyan-200">X-API-Key</code> z
              wartoscia klucza wygenerowanego w panelu aplikacji.
            </p>
            <CodeBlock>{`X-API-Key: ml_twoj_klucz`}</CodeBlock>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-300" />
              <span className="font-display text-sm text-zinc-100">OAuth2</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Do endpointow wymagajacych kontekstu uzytkownika. Uzyj przepływu Authorization Code i przesylaj token w
              nagłowku{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-[11px] text-cyan-200">Authorization</code>.
            </p>
            <CodeBlock>{`Authorization: Bearer eyJhbGci...`}</CodeBlock>
          </Card>
        </div>

        <Card className="p-5">
          <div className="mb-3 font-display text-sm text-zinc-100">Limity zapytan (Rate Limiting)</div>
          <p className="mb-4 text-sm text-slate-400">
            Kazda odpowiedz zawiera nagłowki informujace o biezacym zuzyciu limitu zapytan. Po przekroczeniu limitu
            serwer zwroci kod{" "}
            <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-amber-200">429 Too Many Requests</code>
            .
          </p>
          <div className="space-y-2">
            {[
              {
                header: "X-RateLimit-Limit",
                desc: "Maksymalna liczba zapytan w oknie czasowym",
              },
              {
                header: "X-RateLimit-Remaining",
                desc: "Pozostala liczba zapytan w biezacym oknie",
              },
              {
                header: "X-RateLimit-Reset",
                desc: "Czas (Unix timestamp) resetowania licznika",
              },
            ].map(({ header, desc }) => (
              <div key={header} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                <code className="w-56 shrink-0 font-mono text-xs text-cyan-200">{header}</code>
                <span className="text-sm text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ── Section 3: Uprawnienia ─────────────────────────── */}
      <section id="scopes" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <Shield className="h-[18px] w-[18px] text-violet-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 3</SectionLabel>
            <SectionTitle>Uprawnienia (Scopes)</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          Uprawnienia kontroluja dostep do poszczegolnych zasobow API. Przy tworzeniu aplikacji lub inicjowaniu
          przepływu OAuth2 nalezy okreslic, jakich uprawnien wymaga Twoja integracja.
        </SectionDescription>

        <Card className="overflow-hidden">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="grid grid-cols-[192px_1fr_80px] text-[10px] uppercase tracking-[0.2em] text-slate-600">
              <span>Scope</span>
              <span>Opis</span>
              <span className="text-right">Typ</span>
            </div>
          </div>
          <ScopeRow scope="matches:read" description="Odczyt danych meczy — lista, szczegoly i snapshoty" />
          <ScopeRow scope="leaderboard:read" description="Odczyt rankingu graczy (paginowany)" />
          <ScopeRow scope="players:read" description="Odczyt statystyk graczy" />
          <ScopeRow scope="config:read" description="Odczyt konfiguracji gry (typy budynkow, jednostek, koszty)" />
          <ScopeRow scope="webhooks:manage" description="Tworzenie, edycja i usuwanie webhookow aplikacji" />
          <ScopeRow scope="user:profile" description="Odczyt profilu zalogowanego uzytkownika" oauth />
        </Card>
      </section>

      {/* ── Section 4: Endpointy publiczne ─────────────────── */}
      <section id="endpoints" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <Code className="h-[18px] w-[18px] text-emerald-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 4</SectionLabel>
            <SectionTitle>Endpointy publiczne</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          Wszystkie endpointy ponizej sa dostepne przy uzyciu klucza API (nagłowek{" "}
          <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-cyan-200">X-API-Key</code>
          ). Odpowiedzi sa zwracane w formacie JSON.
        </SectionDescription>

        <Card className="overflow-hidden">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="hidden grid-cols-[60px_1fr_120px_180px] gap-4 text-[10px] uppercase tracking-[0.2em] text-slate-600 sm:grid">
              <span>Metoda</span>
              <span>Sciezka</span>
              <span>Scope</span>
              <span className="text-right">Opis</span>
            </div>
          </div>
          <EndpointRow
            method="GET"
            path="/api/v1/public/leaderboard/"
            scope="leaderboard:read"
            description="Ranking graczy (paginowany)"
          />
          <EndpointRow
            method="GET"
            path="/api/v1/public/matches/"
            scope="matches:read"
            description="Lista zakonczonych meczy"
          />
          <EndpointRow
            method="GET"
            path="/api/v1/public/matches/{id}/"
            scope="matches:read"
            description="Szczegoly meczu"
          />
          <EndpointRow
            method="GET"
            path="/api/v1/public/matches/{id}/snapshots/"
            scope="matches:read"
            description="Lista snapshotow meczu"
          />
          <EndpointRow
            method="GET"
            path="/api/v1/public/matches/{id}/snapshots/{tick}/"
            scope="matches:read"
            description="Dane snapshotu dla danego ticku"
          />
          <EndpointRow
            method="GET"
            path="/api/v1/public/players/{id}/stats/"
            scope="players:read"
            description="Statystyki gracza"
          />
          <EndpointRow method="GET" path="/api/v1/public/config/" scope="config:read" description="Konfiguracja gry" />
        </Card>

        <Card className="p-5">
          <div className="mb-3 font-display text-sm text-zinc-100">Paginacja</div>
          <p className="mb-3 text-sm text-slate-400">
            Endpointy zwracajace listy obsługuja paginacje przez parametry zapytania. Odpowiedz zawiera metadane
            paginacji.
          </p>
          <CodeBlock>{`GET /api/v1/public/leaderboard/?page=2&page_size=20

{
  "count": 1240,
  "next": "https://zelqor.gg/api/v1/public/leaderboard/?page=3",
  "previous": "https://zelqor.gg/api/v1/public/leaderboard/?page=1",
  "results": [ ... ]
}`}</CodeBlock>
        </Card>
      </section>

      {/* ── Section 5: OAuth2 ──────────────────────────────── */}
      <section id="oauth2" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <Lock className="h-[18px] w-[18px] text-violet-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 5</SectionLabel>
            <SectionTitle>OAuth2 — przepływ autoryzacji</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          OAuth2 Authorization Code Flow pozwala Twojej aplikacji dzialac w imieniu uzytkownika Zelqor po uzyskaniu
          jego zgody. Uzywaj tego przepływu, gdy potrzebujesz dostepu do danych konkretnego gracza.
        </SectionDescription>

        <Card className="p-5">
          <div className="mb-4 font-display text-sm text-zinc-100">Diagram przepływu</div>
          <div className="space-y-2">
            <StepItem step={1}>
              Uzytkownik klika <strong className="text-zinc-100">&ldquo;Zaloguj przez Zelqor&rdquo;</strong> w Twojej
              aplikacji.
            </StepItem>
            <StepItem step={2}>
              Twoja aplikacja przekierowuje uzytkownika na{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-cyan-200">
                /api/v1/oauth/authorize/
              </code>{" "}
              z parametrami{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">client_id</code>,{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">redirect_uri</code>,{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">scope</code> i{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">state</code>.
            </StepItem>
            <StepItem step={3}>
              Uzytkownik loguje sie na Zelqor i <strong className="text-zinc-100">autoryzuje</strong> dostep dla Twojej
              aplikacji.
            </StepItem>
            <StepItem step={4}>
              Zelqor przekierowuje uzytkownika z powrotem na{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-cyan-200">redirect_uri</code> z
              parametrem <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">code</code> i{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">state</code>.
            </StepItem>
            <StepItem step={5}>
              Twoj serwer wymienia kod na token: wysyla{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-amber-200">
                POST /api/v1/oauth/token/
              </code>{" "}
              z <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">code</code>,{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">client_id</code> i{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">client_secret</code>.
            </StepItem>
            <StepItem step={6}>
              Uzywaj tokena dostepowego, np.{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-emerald-200">
                GET /api/v1/oauth/userinfo/
              </code>
              , przesylajac go w nagłowku{" "}
              <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-slate-300">
                Authorization: Bearer ...
              </code>
              .
            </StepItem>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 font-display text-sm text-zinc-100">Przyklad — inicjowanie autoryzacji</div>
          <CodeBlock>{`https://zelqor.gg/api/v1/oauth/authorize/
  ?response_type=code
  &client_id=ml_app_abc123
  &redirect_uri=https%3A%2F%2Fmojaserwis.pl%2Fcallback
  &scope=user%3Aprofile%20matches%3Aread
  &state=losowy_unikalny_ciag`}</CodeBlock>
        </Card>

        <Card className="p-5">
          <div className="mb-3 font-display text-sm text-zinc-100">Przyklad — wymiana kodu na token</div>
          <CodeBlock>{`curl -X POST https://zelqor.gg/api/v1/oauth/token/ \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "authorization_code",
    "code": "otrzymany_kod",
    "client_id": "ml_app_abc123",
    "client_secret": "twoj_sekret",
    "redirect_uri": "https://mojaserwis.pl/callback"
  }'

# Odpowiedz:
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_...",
  "scope": "user:profile matches:read"
}`}</CodeBlock>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Endpointy OAuth2</div>
          </div>
          <EndpointRow
            method="POST"
            path="/api/v1/oauth/authorize/"
            scope="—"
            description="Autoryzacja (wymaga logowania)"
          />
          <EndpointRow method="POST" path="/api/v1/oauth/token/" scope="—" description="Wymiana kodu na token" />
          <EndpointRow
            method="GET"
            path="/api/v1/oauth/userinfo/"
            scope="user:profile"
            description="Dane zalogowanego uzytkownika"
          />
          <EndpointRow method="POST" path="/api/v1/oauth/revoke/" scope="—" description="Uniewaznij token dostepowy" />
        </Card>
      </section>

      {/* ── Section 6: Webhooki ────────────────────────────── */}
      <section id="webhooks" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <Webhook className="h-[18px] w-[18px] text-cyan-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 6</SectionLabel>
            <SectionTitle>Webhooki</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          Webhooki pozwalaja Twojej aplikacji otrzymywac powiadomienia o zdarzeniach w grze w czasie rzeczywistym.
          Zelqor wysyla zapytanie HTTP POST na skonfigurowany URL, gdy nastapi okreslone zdarzenie.
        </SectionDescription>

        <Card className="overflow-hidden">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Dostepne zdarzenia</div>
          </div>
          {[
            {
              event: "match.started",
              description: "Mecz zostal rozpoczety — zawiera ID meczu i liste graczy",
            },
            {
              event: "match.finished",
              description: "Mecz zakonczony — zawiera wyniki, ranking i zmiany ELO",
            },
            {
              event: "player.elo_changed",
              description: "ELO gracza uleglo zmianie po zakonczeniu meczu",
            },
          ].map(({ event, description }) => (
            <div
              key={event}
              className="flex flex-col gap-1 border-t border-white/5 px-5 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-6"
            >
              <code className="w-44 shrink-0 font-mono text-xs text-cyan-200">{event}</code>
              <span className="text-sm text-slate-400">{description}</span>
            </div>
          ))}
        </Card>

        <Card className="p-5">
          <div className="mb-2 font-display text-sm text-zinc-100">Weryfikacja podpisu (HMAC-SHA256)</div>
          <p className="mb-3 text-sm text-slate-400">
            Kazde zapytanie webhook zawiera nagłowek{" "}
            <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-cyan-200">X-Zelqor-Signature</code>,
            ktory jest podpisem HMAC-SHA256 ciała zapytania z uzyciem sekretu webhooka skonfigurowanego w panelu
            aplikacji. Zawsze weryfikuj podpis przed przetworzeniem zdarzenia.
          </p>
          <CodeBlock>{`import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    """Zweryfikuj podpis webhooka Zelqor."""
    expected = hmac.new(
        secret.encode("utf-8"),
        msg=payload,
        digestmod=hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

# Uzycie w widoku Django / FastAPI:
raw_body = request.body          # bajty, nie zdekodowany JSON
sig = request.headers.get("X-Zelqor-Signature", "")
if not verify_webhook(raw_body, sig, WEBHOOK_SECRET):
    return HttpResponse(status=401)`}</CodeBlock>
        </Card>

        <Card className="p-5">
          <div className="mb-2 font-display text-sm text-zinc-100">Ponowne proby i dezaktywacja</div>
          <p className="text-sm leading-6 text-slate-400">
            Jesli Twoj serwer odpowie kodem innym niz{" "}
            <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-emerald-200">2xx</code>, Zelqor ponowi
            probe z wykładniczym opóznieniem:{" "}
            <strong className="text-slate-200">5 s, 30 s, 2 min, 10 min, 30 min</strong>. Po{" "}
            <strong className="text-slate-200">10 nieudanych probach</strong> webhook zostanie automatycznie
            dezaktywowany. Bedziesz mogl go reaktywowac recznie w panelu aplikacji.
          </p>
        </Card>
      </section>

      {/* ── Section 7: Kody bledow ─────────────────────────── */}
      <section id="errors" className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
            <AlertTriangle className="h-[18px] w-[18px] text-amber-300" />
          </div>
          <div>
            <SectionLabel>Sekcja 7</SectionLabel>
            <SectionTitle>Kody bledow</SectionTitle>
          </div>
        </div>

        <SectionDescription>
          API zwraca standardowe kody statusu HTTP. Ciało odpowiedzi bledu zawsze zawiera pole{" "}
          <code className="rounded bg-white/[0.07] px-1 font-mono text-xs text-cyan-200">detail</code> z czytelnym
          opisem przyczyny.
        </SectionDescription>

        <Card className="overflow-hidden">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="hidden grid-cols-[48px_160px_1fr] gap-6 text-[10px] uppercase tracking-[0.2em] text-slate-600 sm:grid">
              <span>Kod</span>
              <span>Nazwa</span>
              <span>Opis</span>
            </div>
          </div>
          <ErrorRow
            code={400}
            name="Bad Request"
            description="Nieprawidlowe dane wejsciowe — sprawdz parametry zapytania lub cialo"
          />
          <ErrorRow code={401} name="Unauthorized" description="Brakujacy lub nieprawidlowy klucz API / token OAuth2" />
          <ErrorRow
            code={403}
            name="Forbidden"
            description="Klucz jest prawidlowy, ale brakuje wymaganych uprawnien (scope)"
          />
          <ErrorRow
            code={404}
            name="Not Found"
            description="Zasob o podanym ID nie istnieje lub nie masz do niego dostepu"
          />
          <ErrorRow
            code={429}
            name="Too Many Requests"
            description="Przekroczono limit zapytan — odczekaj do resetu okna czasowego"
          />
        </Card>

        <Card className="p-5">
          <div className="mb-3 font-display text-sm text-zinc-100">Format odpowiedzi bledu</div>
          <CodeBlock>{`HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "detail": "Brakujace uprawnienie: matches:read",
  "code": "permission_denied"
}`}</CodeBlock>
        </Card>
      </section>

      {/* ── Footer CTA ─────────────────────────────────────── */}
      <div className="rounded-[24px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.06),rgba(15,118,110,0.04))] p-6 text-center">
        <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70">Gotowy do integracji?</div>
        <h3 className="mt-2 font-display text-xl text-zinc-50">Utworz swoja pierwsza aplikacje</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
          Przejdz do portalu deweloperskiego, aby wygenerowac klucze API i skonfigurowac webhooki dla swojej integracji
          z Zelqor.
        </p>
        <Link
          href="/developers"
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 py-2.5 font-display text-sm uppercase tracking-[0.2em] text-slate-950 transition-opacity hover:opacity-90"
        >
          <Code className="h-4 w-4" />
          Portal deweloperski
        </Link>
      </div>
    </div>
  );
}
