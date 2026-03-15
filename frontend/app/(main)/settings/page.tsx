"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import Image from "next/image";
import {
  User,
  Lock,
  Gamepad2,
  Bell,
  AlertTriangle,
  CheckCircle2,
  LogOut,
} from "lucide-react";

export default function SettingsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const { permission, subscribed, subscribe, unsubscribe } = usePushNotifications();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Image
          src="/assets/match_making/circle291.webp"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 animate-spin object-contain"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Page header */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground">USTAWIENIA</p>
        <h1 className="font-display text-2xl md:text-3xl text-foreground">Ustawienia</h1>
      </div>

      {/* Account section */}
      <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
            <User className="h-4 w-4 text-primary" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
            Konto
          </p>
        </div>

        <div className="space-y-4">
          {/* Username row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
                Nazwa użytkownika
              </label>
              <p className="mt-1 text-sm font-medium text-foreground">
                {user.username}
              </p>
            </div>
            <button
              disabled
              className="flex w-fit items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground cursor-not-allowed"
              title="Wkrótce dostępne"
            >
              Zmień
            </button>
          </div>

          {/* Email row */}
          <div className="border-t border-border pt-4">
            <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
              Adres email
            </label>
            <p className="mt-1 text-sm font-medium text-foreground">
              {user.email}
            </p>
          </div>

          {/* Role row */}
          <div className="border-t border-border pt-4">
            <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
              Rola
            </label>
            <p className="mt-1 text-sm font-medium text-foreground capitalize">
              {user.role}
            </p>
          </div>
        </div>
      </section>

      {/* Password section */}
      <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
            <Lock className="h-4 w-4 text-amber-300" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
            Hasło
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Zmień hasło do swojego konta
          </p>
          <button
            disabled
            className="flex w-fit items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground cursor-not-allowed"
            title="Wkrótce dostępne"
          >
            <Lock className="h-3.5 w-3.5" />
            Zmień hasło
          </button>
        </div>
      </section>

      {/* Push notifications section */}
      {"Notification" in globalThis && (
        <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
              <Bell className="h-4 w-4 text-blue-300" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
              Powiadomienia push
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-foreground">
                {subscribed ? "Powiadomienia włączone" : "Powiadomienia wyłączone"}
              </p>
              <p className="text-xs text-muted-foreground">
                {permission === "denied"
                  ? "Powiadomienia zablokowane w przeglądarce — zmień w ustawieniach"
                  : "Otrzymuj powiadomienia o znalezionym meczu i ważnych wydarzeniach"}
              </p>
            </div>
            {permission !== "denied" && (
              <button
                onClick={subscribed ? unsubscribe : subscribe}
                className={`flex w-fit items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                  subscribed
                    ? "border-border bg-secondary text-muted-foreground hover:bg-secondary/80"
                    : "border-blue-400/30 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
                }`}
              >
                <Bell className="h-3.5 w-3.5" />
                {subscribed ? "Wyłącz" : "Włącz"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Game section */}
      <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
            <Gamepad2 className="h-4 w-4 text-emerald-300" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
            Gra
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Samouczek</p>
              <p className="text-xs text-muted-foreground">
                Status ukończenia wstępnego samouczka
              </p>
            </div>
            <div className="flex items-center gap-2">
              {user.tutorial_completed ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-emerald-300">Ukończony</span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-slate-600" />
                  <span className="text-xs text-muted-foreground">
                    Nieukończony
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-4 md:p-6 mx-4 md:mx-0">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10">
            <AlertTriangle className="h-4 w-4 text-red-400" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-red-500/80">
            Niebezpieczna strefa
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-foreground">
              Wyloguj ze wszystkich urządzeń
            </p>
            <p className="text-xs text-muted-foreground">
              Unieważnia wszystkie aktywne sesje — zostaniesz wylogowany
              wszędzie
            </p>
          </div>
          <button
            onClick={logout}
            className="flex w-fit items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/25"
          >
            <LogOut className="h-3.5 w-3.5" />
            Wyloguj
          </button>
        </div>
      </section>
    </div>
  );
}
