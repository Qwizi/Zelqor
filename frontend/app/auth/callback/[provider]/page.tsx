"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import AuthScreen from "@/components/auth/AuthScreen";
import { useAuth } from "@/hooks/useAuth";
import { socialAuthCallback } from "@/lib/api";

function CallbackContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { loginWithTokens } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const processedRef = useRef(false);

  const provider = params.provider as "google" | "discord";
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    if (errorParam) {
      setError("Logowanie zostało anulowane.");
      return;
    }

    if (!code) {
      setError("Brak kodu autoryzacji.");
      return;
    }

    if (!["google", "discord"].includes(provider)) {
      setError("Nieznany dostawca logowania.");
      return;
    }

    const redirectUri = `${window.location.origin}/auth/callback/${provider}`;

    socialAuthCallback(provider, code, redirectUri, state)
      .then(async (tokens) => {
        await loginWithTokens(tokens.access, tokens.refresh);
        router.replace("/dashboard");
      })
      .catch(() => {
        setError("Nie udało się zalogować. Spróbuj ponownie.");
      });
  }, [code, state, errorParam, provider, router, loginWithTokens]);

  if (error) {
    return (
      <AuthScreen eyebrow="Błąd" title="Logowanie nie powiodło się">
        <div className="space-y-4">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
          <button
            onClick={() => router.push("/login")}
            className="w-full h-12 rounded-xl bg-primary font-display text-sm uppercase tracking-wider text-primary-foreground hover:bg-primary/90 transition-all"
          >
            Wróć do logowania
          </button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen eyebrow="Logowanie" title="Łączenie konta...">
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Trwa weryfikacja danych z {provider === "google" ? "Google" : "Discord"}...
        </p>
      </div>
    </AuthScreen>
  );
}

export default function SocialCallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  );
}
