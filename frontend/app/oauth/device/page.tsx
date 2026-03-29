"use client";

import { Check, Keyboard, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import AuthScreen from "@/components/auth/AuthScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { APIError, oauthDeviceAuthorize } from "@/lib/api";

// -- Helpers ------------------------------------------------------------------

function formatUserCode(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

function isCodeComplete(code: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
}

// -- Inner (needs Suspense because of useSearchParams) ------------------------

function OAuthDeviceInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const initialCode = searchParams.get("code") ?? "";

  const [code, setCode] = useState<string>(() => formatUserCode(initialCode));
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Redirect to login if unauthenticated
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const currentParams = searchParams.toString();
      const next = currentParams ? `/oauth/device?${currentParams}` : "/oauth/device";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [user, authLoading, router, searchParams]);

  // Focus input on mount
  useEffect(() => {
    if (!authLoading && user) {
      inputRef.current?.focus();
    }
  }, [authLoading, user]);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatUserCode(e.target.value);
    setCode(formatted);
    setErrorMessage(null);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isCodeComplete(code)) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await oauthDeviceAuthorize(code);
      setSuccess(true);
    } catch (err) {
      if (err instanceof APIError) {
        if (err.status === 404) {
          setErrorMessage("Nieprawidłowy kod. Sprawdź kod i spróbuj ponownie.");
        } else if (err.status === 400) {
          const body = err.body as Record<string, unknown> | undefined;
          const detail = typeof body?.detail === "string" ? body.detail : null;
          if (detail?.toLowerCase().includes("expir")) {
            setErrorMessage("Kod wygasł. Wygeneruj nowy kod w terminalu.");
          } else if (detail?.toLowerCase().includes("already")) {
            setErrorMessage("To urządzenie zostało już autoryzowane.");
          } else {
            setErrorMessage(detail ?? "Błąd autoryzacji. Spróbuj ponownie.");
          }
        } else {
          setErrorMessage("Wystąpił nieoczekiwany błąd. Spróbuj ponownie.");
        }
      } else {
        setErrorMessage("Brak połączenia. Sprawdź sieć i spróbuj ponownie.");
      }
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setCode("");
    setErrorMessage(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Auth loading / not yet redirected
  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // -- Success state ----------------------------------------------------------

  if (success) {
    return (
      <AuthScreen eyebrow="Autoryzacja" title="Urządzenie autoryzowane">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10">
            <Check className="h-8 w-8 text-emerald-400" />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Możesz zamknąć tę kartę i wrócić do terminala.
          </p>
          <div className="w-full rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] px-4 py-3">
            <p className="text-xs text-emerald-300/80">Sesja została pomyślnie uwierzytelniona.</p>
          </div>
        </div>
      </AuthScreen>
    );
  }

  // -- Form state -------------------------------------------------------------

  return (
    <AuthScreen
      eyebrow="Autoryzacja"
      title="Autoryzacja urządzenia"
      description="Wpisz kod wyświetlony w terminalu, aby połączyć urządzenie z kontem."
    >
      <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
        {/* Icon */}
        <div className="flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary">
            <Keyboard className="h-6 w-6 text-primary" />
          </div>
        </div>

        {/* Code input */}
        <div className="space-y-2 md:space-y-3">
          <Label htmlFor="user-code" className="text-sm">
            Kod urządzenia
          </Label>
          <Input
            ref={inputRef}
            id="user-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            placeholder="XXXX-XXXX"
            value={code}
            onChange={handleCodeChange}
            disabled={submitting}
            className={`h-12 md:h-14 w-full text-center font-mono text-2xl tracking-[0.25em] rounded-xl md:rounded-xl ${errorMessage ? "border-destructive" : ""}`}
          />
          <p className="text-center text-xs text-muted-foreground">8 znaków alfanumerycznych</p>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="rounded-xl md:rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 md:px-6 md:py-4">
            <p className="text-center text-sm text-destructive">{errorMessage}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-1 block w-full text-center text-xs text-destructive/70 underline underline-offset-2 hover:text-destructive transition-colors"
            >
              Spróbuj ponownie
            </button>
          </div>
        )}

        {/* Submit button */}
        <Button
          type="submit"
          disabled={submitting || !isCodeComplete(code)}
          className="h-12 md:h-14 w-full rounded-full md:rounded-xl bg-primary font-display text-base md:text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Autoryzowanie...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Autoryzuj
            </>
          )}
        </Button>

        {/* Logged-in-as notice */}
        <p className="text-center text-xs text-muted-foreground">
          Zalogowano jako <span className="font-medium text-foreground">{user.username}</span>
        </p>
      </form>
    </AuthScreen>
  );
}

// -- Page export --------------------------------------------------------------

export default function OAuthDevicePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <OAuthDeviceInner />
    </Suspense>
  );
}
