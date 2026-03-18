"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { linkSocialAccount } from "@/lib/api";
import AuthScreen from "@/components/auth/AuthScreen";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

function LinkContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
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
      setError("Podłączanie zostało anulowane.");
      return;
    }

    if (!code) {
      setError("Brak kodu autoryzacji.");
      return;
    }

    if (!token) {
      setError("Musisz być zalogowany aby podłączyć konto.");
      return;
    }

    if (!["google", "discord"].includes(provider)) {
      setError("Nieznany dostawca.");
      return;
    }

    const redirectUri = `${window.location.origin}/auth/link/${provider}`;

    linkSocialAccount(token, provider, code, redirectUri, state)
      .then(() => {
        toast.success(
          `Konto ${provider === "google" ? "Google" : "Discord"} zostało podłączone.`
        );
        router.replace("/settings");
      })
      .catch(() => {
        setError("Nie udało się podłączyć konta. Możliwe, że jest już używane.");
      });
  }, [code, state, errorParam, provider, router, token]);

  if (error) {
    return (
      <AuthScreen eyebrow="Błąd" title="Podłączanie nie powiodło się">
        <div className="space-y-4">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
          <button
            onClick={() => router.push("/settings")}
            className="w-full h-12 rounded-xl bg-primary font-display text-sm uppercase tracking-wider text-primary-foreground hover:bg-primary/90 transition-all"
          >
            Wróć do ustawień
          </button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen eyebrow="Podłączanie" title="Łączenie konta...">
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Trwa podłączanie konta{" "}
          {provider === "google" ? "Google" : "Discord"}...
        </p>
      </div>
    </AuthScreen>
  );
}

export default function SocialLinkPage() {
  return (
    <Suspense>
      <LinkContent />
    </Suspense>
  );
}
