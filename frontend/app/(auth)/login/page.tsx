"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthScreen from "@/components/auth/AuthScreen";
import { toast } from "sonner";
import { APIError, type User } from "@/lib/api";
import { Trophy, Plus, X, ChevronRight, ArrowLeft, Save, SkipForward } from "lucide-react";

// ---------------------------------------------------------------------------
// Saved profiles — stored in localStorage, no passwords
// ---------------------------------------------------------------------------

interface SavedProfile {
  username: string;
  email: string;
  avatar: string | null;
  elo_rating: number;
}

function getSavedProfiles(): SavedProfile[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("maplord_profiles") || "[]");
  } catch {
    return [];
  }
}

function saveProfile(user: User) {
  const profiles = getSavedProfiles();
  const existing = profiles.findIndex((p) => p.username === user.username);
  const profile: SavedProfile = {
    username: user.username,
    email: user.email,
    avatar: null,
    elo_rating: user.elo_rating,
  };
  if (existing >= 0) {
    profiles[existing] = profile;
  } else {
    profiles.unshift(profile);
  }
  localStorage.setItem(
    "maplord_profiles",
    JSON.stringify(profiles.slice(0, 5))
  );
}

function isProfileSaved(username: string): boolean {
  return getSavedProfiles().some((p) => p.username === username);
}

function removeProfile(username: string) {
  const profiles = getSavedProfiles().filter((p) => p.username !== username);
  localStorage.setItem("maplord_profiles", JSON.stringify(profiles));
}

// ---------------------------------------------------------------------------
// Login schema
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  identifier: z.string().min(1, "Nazwa uzytkownika lub email jest wymagana"),
  password: z.string().min(1, "Haslo jest wymagane"),
});

type LoginFormData = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Profile card
// ---------------------------------------------------------------------------

function ProfileCard({
  profile,
  onSelect,
  onRemove,
}: {
  profile: SavedProfile;
  onSelect: (profile: SavedProfile) => void;
  onRemove: (username: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(profile)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(profile); } }}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition-all hover:border-cyan-300/20 hover:bg-white/[0.06]"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display text-lg text-slate-950">
        {profile.username[0].toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-zinc-100">
          {profile.username}
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <Trophy className="h-3 w-3 text-amber-300" />
          {profile.elo_rating} ELO
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(profile.username);
        }}
        className="rounded-lg p-1.5 text-slate-500 opacity-0 transition-all hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
        title="Usun profil"
      >
        <X className="h-4 w-4" />
      </button>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-cyan-300" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main login form component
// ---------------------------------------------------------------------------

type ViewState =
  | { kind: "profiles" }
  | { kind: "form"; selectedProfile: SavedProfile | null }
  | { kind: "save-prompt" }
  | { kind: "auto-save" };

function LoginForm() {
  const { login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next");

  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [view, setView] = useState<ViewState>({ kind: "profiles" });
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Load profiles once on the client
  useEffect(() => {
    const profiles = getSavedProfiles();
    setSavedProfiles(profiles);
    if (profiles.length === 0) {
      setView({ kind: "form", selectedProfile: null });
    }
  }, []);

  const {
    register: rhfRegister,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const selectProfile = useCallback(
    (profile: SavedProfile) => {
      setView({ kind: "form", selectedProfile: profile });
      setValue("identifier", profile.username);
      setGeneralError(null);
    },
    [setValue]
  );

  const handleRemoveProfile = useCallback((username: string) => {
    removeProfile(username);
    setSavedProfiles((prev) => {
      const next = prev.filter((p) => p.username !== username);
      if (next.length === 0) {
        setView({ kind: "form", selectedProfile: null });
      }
      return next;
    });
  }, []);

  const backToProfiles = useCallback(() => {
    setView({ kind: "profiles" });
    setGeneralError(null);
  }, []);

  const redirectToDashboard = useCallback(() => {
    router.push(nextUrl || "/dashboard");
  }, [router, nextUrl]);

  const handleSaveProfile = useCallback(() => {
    if (user) {
      saveProfile(user);
      toast.success("Profil zapisany");
    }
    redirectToDashboard();
  }, [user, redirectToDashboard]);

  const handleSkipSave = useCallback(() => {
    redirectToDashboard();
  }, [redirectToDashboard]);

  const onSubmit = async (data: LoginFormData) => {
    setGeneralError(null);
    try {
      await login(data.identifier, data.password);
      // Don't redirect yet — check if we should ask to save profile
    } catch (err: unknown) {
      if (err instanceof APIError) {
        if (
          err.status === 401 ||
          err.message.toLowerCase().includes("credentials") ||
          err.message.toLowerCase().includes("no active account")
        ) {
          setGeneralError("Nieprawidlowy login lub haslo");
        } else if (
          err.status === 400 &&
          err.body &&
          typeof err.body === "object"
        ) {
          const body = err.body as Record<string, unknown>;
          let hasFieldError = false;
          if (body.email || body.identifier) {
            const msg = body.email || body.identifier;
            setError("identifier", {
              message: Array.isArray(msg) ? msg[0] : String(msg),
            });
            hasFieldError = true;
          }
          if (body.password) {
            setError("password", {
              message: Array.isArray(body.password)
                ? body.password[0]
                : String(body.password),
            });
            hasFieldError = true;
          }
          if (!hasFieldError) {
            setGeneralError("Wystapil blad podczas logowania. Sprobuj ponownie.");
          }
        } else {
          setGeneralError("Wystapil blad podczas logowania. Sprobuj ponownie.");
        }
      } else {
        setGeneralError("Wystapil blad podczas logowania. Sprobuj ponownie.");
      }
      return; // don't proceed on error
    }

    // Login succeeded — if profile already saved, update and go to dashboard
    // Otherwise show save prompt (user state will update via useAuth)
    if (isProfileSaved(data.identifier)) {
      setView({ kind: "auto-save" } as ViewState);
    } else {
      setView({ kind: "save-prompt" });
    }
  };

  // Auto-save existing profile and redirect once user is available
  useEffect(() => {
    if ((view as { kind: string }).kind === "auto-save" && user) {
      saveProfile(user);
      redirectToDashboard();
    }
  }, [view, user, redirectToDashboard]);

  const selectedProfile = view.kind === "form" ? view.selectedProfile : null;

  // -------------------------------------------------------------------------
  // Render: Save Profile Prompt (after successful login)
  // -------------------------------------------------------------------------

  if (view.kind === "save-prompt") {
    return (
      <AuthScreen
        eyebrow="Access Portal"
        title="Zalogowano"
        description="Czy chcesz zapisac ten profil? Nastepnym razem wystarczy tylko haslo."
        altPrompt=""
        altHref=""
        altLabel=""
      >
        <div className="space-y-4">
          {/* Profile preview */}
          {user && (
            <div className="flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-500/5 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display text-xl text-slate-950">
                {user.username[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-medium text-zinc-50">
                  {user.username}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-400">
                  <Trophy className="h-3.5 w-3.5 text-amber-300" />
                  {user.elo_rating} ELO
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={handleSkipSave}
              variant="outline"
              className="h-11 flex-1 gap-2 rounded-xl border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-zinc-100"
            >
              <SkipForward className="h-4 w-4" />
              Nie, dziekuje
            </Button>
            <Button
              onClick={handleSaveProfile}
              className="h-11 flex-1 gap-2 rounded-xl border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display text-sm uppercase tracking-[0.15em] text-slate-950 hover:opacity-95"
            >
              <Save className="h-4 w-4" />
              Zapisz profil
            </Button>
          </div>

          <p className="text-center text-xs text-slate-500">
            Zapisywane sa tylko nazwa i ELO — nigdy haslo.
          </p>
        </div>
      </AuthScreen>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Profile Selector
  // -------------------------------------------------------------------------

  if (view.kind === "profiles" && savedProfiles.length > 0) {
    return (
      <AuthScreen
        eyebrow="Access Portal"
        title="Witaj z powrotem"
        description="Wybierz profil, aby kontynuowac. Potrzebujesz tylko hasla."
        altPrompt="Nie masz konta?"
        altHref="/register"
        altLabel="Zarejestruj sie"
      >
        <div className="space-y-3">
          {savedProfiles.map((profile) => (
            <ProfileCard
              key={profile.username}
              profile={profile}
              onSelect={selectProfile}
              onRemove={handleRemoveProfile}
            />
          ))}

          <button
            onClick={() => {
              setView({ kind: "form", selectedProfile: null });
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-sm text-slate-400 transition-colors hover:border-white/20 hover:text-zinc-200"
          >
            <Plus className="h-4 w-4" />
            Zaloguj na inne konto
          </button>
        </div>
      </AuthScreen>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Login Form
  // -------------------------------------------------------------------------

  return (
    <AuthScreen
      eyebrow="Access Portal"
      title="Logowanie"
      description="Wejdz do panelu dowodzenia i wracaj do swoich meczow rankingowych na mapie swiata."
      altPrompt="Nie masz konta?"
      altHref="/register"
      altLabel="Zarejestruj sie"
    >
      <div className="space-y-5">
        {/* Back link */}
        {savedProfiles.length > 0 && (
          <button
            onClick={backToProfiles}
            className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Powrot do wyboru profilu
          </button>
        )}

        {/* Selected profile preview */}
        {selectedProfile && (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display text-base text-slate-950">
              {selectedProfile.username[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-zinc-100">
                {selectedProfile.username}
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Trophy className="h-3 w-3 text-amber-300" />
                {selectedProfile.elo_rating} ELO
              </div>
            </div>
          </div>
        )}

        {/* General error */}
        {generalError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Identifier field — hidden when a saved profile is selected */}
          {!selectedProfile && (
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-slate-300">
                Nazwa uzytkownika lub email
              </Label>
              <Input
                id="identifier"
                type="text"
                placeholder="dowodca lub dowodca@maplord.gg"
                autoComplete="username"
                className={`h-11 rounded-xl bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500 ${
                  errors.identifier ? "border-red-500/40" : "border-white/10"
                }`}
                {...rhfRegister("identifier")}
              />
              {errors.identifier && (
                <p className="mt-1 text-xs text-red-400">
                  {errors.identifier.message}
                </p>
              )}
            </div>
          )}

          {/* Password field */}
          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300">
              Haslo
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus={!!selectedProfile}
              className={`h-11 rounded-xl bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500 ${
                errors.password ? "border-red-500/40" : "border-white/10"
              }`}
              {...rhfRegister("password")}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-400">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="h-11 w-full rounded-xl border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display text-sm uppercase tracking-[0.22em] text-slate-950 hover:opacity-95"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Logowanie..." : "Wejdz do gry"}
          </Button>
        </form>
      </div>
    </AuthScreen>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
