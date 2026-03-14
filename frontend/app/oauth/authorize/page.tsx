"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Shield, Trophy, AlertTriangle, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import {
  getAppByClientId,
  oauthAuthorize,
  type OAuthAppInfo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

// ── Scope definitions ─────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
  "user:profile": "Odczyt profilu (nazwa, email, ELO)",
  "matches:read": "Odczyt danych meczy",
  "leaderboard:read": "Odczyt rankingu",
  "players:read": "Odczyt statystyk graczy",
  "config:read": "Odczyt konfiguracji gry",
  "webhooks:manage": "Zarzadzanie webhookami",
};

function parseScopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

function parseScopes(raw: string): string[] {
  return raw
    .split(/[\s+,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRedirectUrl(
  base: string,
  params: Record<string, string>
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#1a2740_0%,#09111d_48%,#04070d_100%)]">
      <Loader2 className="h-8 w-8 animate-spin text-cyan-300/60" />
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#1a2740_0%,#09111d_48%,#04070d_100%)] px-4">
      <div className="w-full max-w-md rounded-[24px] border border-red-500/20 bg-slate-950/80 p-8 text-center backdrop-blur-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10">
          <AlertTriangle className="h-6 w-6 text-red-300" />
        </div>
        <h2 className="font-display text-xl text-zinc-50">Blad autoryzacji</h2>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
      </div>
    </div>
  );
}

// ── Page inner (needs Suspense because of useSearchParams) ────────────────────

function OAuthAuthorizeInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading, token } = useAuth();

  const clientId = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const scopeRaw = searchParams.get("scope") ?? "";
  const state = searchParams.get("state") ?? undefined;

  const scopes = parseScopes(scopeRaw);

  const [appInfo, setAppInfo] = useState<OAuthAppInfo | null>(null);
  const [appLoading, setAppLoading] = useState(true);
  const [paramError, setParamError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Redirect to login if unauthenticated
  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      const currentParams = searchParams.toString();
      router.replace(
        `/login?next=${encodeURIComponent(`/oauth/authorize?${currentParams}`)}`
      );
    }
  }, [user, authLoading, token, router, searchParams]);

  // Validate required query params
  useEffect(() => {
    if (!clientId) {
      setParamError("Nieprawidlowy identyfikator aplikacji");
      setAppLoading(false);
      return;
    }
    if (!redirectUri) {
      setParamError("Brak adresu przekierowania");
      setAppLoading(false);
      return;
    }
    if (scopes.length === 0) {
      setParamError("Nieprawidlowe uprawnienia");
      setAppLoading(false);
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, redirectUri, scopeRaw]);

  // Fetch app info by client_id
  useEffect(() => {
    if (paramError) return;
    if (!clientId) return;

    let cancelled = false;

    async function load() {
      const info = await getAppByClientId(clientId);
      if (!cancelled) {
        setAppInfo(info);
        setAppLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [clientId, paramError]);

  const handleAllow = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const result = await oauthAuthorize(token, {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopeRaw,
        state,
      });
      const params: Record<string, string> = { code: result.code };
      if (result.state) params["state"] = result.state;
      window.location.href = buildRedirectUrl(redirectUri, params);
    } catch {
      toast.error("Nie udalo sie autoryzowac aplikacji. Sprobuj ponownie.");
      setSubmitting(false);
    }
  };

  const handleDeny = () => {
    const params: Record<string, string> = { error: "access_denied" };
    if (state) params["state"] = state;
    window.location.href = buildRedirectUrl(redirectUri, params);
  };

  // States: auth loading
  if (authLoading) return <Spinner />;

  // Not yet redirected (no user), show nothing to avoid flash
  if (!user || !token) return <Spinner />;

  // Param validation error
  if (paramError) return <ErrorScreen message={paramError} />;

  // App info still loading
  if (appLoading) return <Spinner />;

  const appName = appInfo?.name ?? clientId;
  const appDescription = appInfo?.description ?? null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#1a2740_0%,#09111d_48%,#04070d_100%)] text-zinc-100">
      {/* Hex tile texture */}
      <div className="pointer-events-none absolute inset-0 bg-[url('/assets/ui/hex_bg_tile.webp')] bg-[size:240px] opacity-[0.05]" />

      {/* Ambient glows */}
      <div className="pointer-events-none absolute right-0 top-0 h-[360px] w-[360px] opacity-40">
        <Image
          src="/assets/match_making/g707.webp"
          alt=""
          fill
          className="object-contain object-top-right"
        />
      </div>
      <div className="pointer-events-none absolute left-0 top-24 h-[280px] w-[280px] opacity-25">
        <Image
          src="/assets/match_making/g16.webp"
          alt=""
          fill
          className="object-contain object-left"
        />
      </div>

      {/* Centered card */}
      <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-slate-950/80 p-8 backdrop-blur-xl">

          {/* MapLord logo */}
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <Image
                src="/assets/common/world.webp"
                alt="MapLord"
                width={36}
                height={36}
                className="h-9 w-9 object-contain"
              />
            </div>
            <span className="font-display text-lg text-zinc-200 tracking-wide">
              MapLord
            </span>
          </div>

          {/* Title */}
          <h1 className="text-center font-display text-2xl text-zinc-50">
            Autoryzacja aplikacji
          </h1>

          {/* App request card */}
          <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
                <Shield className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="min-w-0">
                <p className="text-sm leading-snug text-zinc-100">
                  <span className="font-semibold text-zinc-50">{appName}</span>{" "}
                  prosi o dostep do Twojego konta
                </p>
                {appDescription && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    {appDescription}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Scopes */}
          <div className="mt-5">
            <div className="mb-2.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Ta aplikacja chce:
            </div>
            <ul className="space-y-2">
              {scopes.map((scope) => (
                <li
                  key={scope}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/8">
                    <Shield className="h-3.5 w-3.5 text-cyan-300" />
                  </div>
                  <span className="text-sm text-zinc-300">
                    {parseScopeLabel(scope)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Logged-in-as notice */}
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
            <div className="text-xs text-slate-500">Zalogowany jako:</div>
            <span className="text-sm font-medium text-zinc-200">
              {user.username}
            </span>
            <div className="ml-auto flex items-center gap-1 rounded-full bg-amber-400/12 px-2 py-0.5 text-xs font-medium text-amber-200">
              <Trophy className="h-3 w-3" />
              {user.elo_rating}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <Button
              variant="outline"
              onClick={handleDeny}
              disabled={submitting}
              className="flex-1 gap-2 rounded-full border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-zinc-100 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Odmow
            </Button>
            <Button
              onClick={handleAllow}
              disabled={submitting}
              className="flex-1 gap-2 rounded-full border border-emerald-300/30 bg-[linear-gradient(135deg,#34d399,#059669)] font-display uppercase tracking-[0.15em] text-slate-950 hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {submitting ? "Przetwarzanie…" : "Zezwol"}
            </Button>
          </div>

          {/* Security notice */}
          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-600">
            Autoryzujac, zgadzasz sie na udostepnienie powyzszych danych tej
            aplikacji. Mozesz cofnac dostep w ustawieniach konta.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Default export wrapped in Suspense (required by useSearchParams) ──────────

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OAuthAuthorizeInner />
    </Suspense>
  );
}
