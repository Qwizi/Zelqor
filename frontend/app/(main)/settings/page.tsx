"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import Image from "next/image";
import {
  User,
  Lock,
  Gamepad2,
  AlertTriangle,
  CheckCircle2,
  LogOut,
} from "lucide-react";

export default function SettingsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

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
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
          USTAWIENIA
        </p>
        <h1 className="font-display text-3xl text-zinc-50">
          Ustawienia konta
        </h1>
      </div>

      {/* Account section */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <User className="h-4 w-4 text-cyan-300" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Konto
          </p>
        </div>

        <div className="space-y-4">
          {/* Username row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Nazwa użytkownika
              </label>
              <p className="mt-1 text-sm font-medium text-zinc-50">
                {user.username}
              </p>
            </div>
            <button
              disabled
              className="flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-500 cursor-not-allowed"
              title="Wkrótce dostępne"
            >
              Zmień
            </button>
          </div>

          {/* Email row */}
          <div className="border-t border-white/[0.06] pt-4">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Adres email
            </label>
            <p className="mt-1 text-sm font-medium text-zinc-50">
              {user.email}
            </p>
          </div>

          {/* Role row */}
          <div className="border-t border-white/[0.06] pt-4">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Rola
            </label>
            <p className="mt-1 text-sm font-medium text-zinc-50 capitalize">
              {user.role}
            </p>
          </div>
        </div>
      </section>

      {/* Password section */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Lock className="h-4 w-4 text-amber-300" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Hasło
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-400">
            Zmień hasło do swojego konta
          </p>
          <button
            disabled
            className="flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-500 cursor-not-allowed"
            title="Wkrótce dostępne"
          >
            <Lock className="h-3.5 w-3.5" />
            Zmień hasło
          </button>
        </div>
      </section>

      {/* Game section */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Gamepad2 className="h-4 w-4 text-emerald-300" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Gra
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-50">Samouczek</p>
              <p className="text-xs text-slate-500">
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
                  <span className="text-xs text-slate-500">
                    Nieukończony
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-6 backdrop-blur-xl">
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
            <p className="text-sm text-zinc-50">
              Wyloguj ze wszystkich urządzeń
            </p>
            <p className="text-xs text-slate-500">
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
