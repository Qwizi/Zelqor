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
import { Trophy, Plus, X, ArrowLeft, Save, SkipForward } from "lucide-react";

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
  identifier: z.string().min(1, "Nazwa użytkownika lub email jest wymagana"),
  password: z.string().min(1, "Hasło jest wymagane"),
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
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(profile);
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-border bg-secondary p-5 text-left transition-all hover:border-border/60 hover:bg-muted"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/20 font-display text-2xl text-primary">
        {profile.username[0].toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xl font-semibold text-foreground">
          {profile.username}
        </div>
        <div className="flex items-center gap-1.5 text-base text-muted-foreground">
          <Trophy className="h-4 w-4 text-accent" />
          {profile.elo_rating} ELO
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(profile.username);
        }}
        className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
        title="Usuń profil"
      >
        <X className="h-4 w-4" />
      </button>
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

  // Redirect if already logged in
  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

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
    } catch (err: unknown) {
      if (err instanceof APIError) {
        if (
          err.status === 401 ||
          err.message.toLowerCase().includes("credentials") ||
          err.message.toLowerCase().includes("no active account")
        ) {
          setGeneralError("Nieprawidłowy login lub hasło");
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
            setGeneralError("Wystąpił błąd podczas logowania. Spróbuj ponownie.");
          }
        } else {
          setGeneralError("Wystąpił błąd podczas logowania. Spróbuj ponownie.");
        }
      } else {
        setGeneralError("Wystąpił błąd podczas logowania. Spróbuj ponownie.");
      }
      return;
    }

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
        eyebrow="Zalogowano"
        title="Zapisz profil"
        description="Czy chcesz zapisać ten profil? Następnym razem wystarczy tylko hasło."
      >
        <div className="space-y-4">
          {/* Profile preview */}
          {user && (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/20 font-display text-xl text-primary">
                {user.username[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-medium text-foreground">
                  {user.username}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Trophy className="h-3.5 w-3.5 text-accent" />
                  {user.elo_rating} ELO
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={handleSkipSave}
              variant="outline"
              className="h-11 flex-1 gap-2 rounded-xl"
            >
              <SkipForward className="h-4 w-4" />
              Nie, dziękuję
            </Button>
            <Button
              onClick={handleSaveProfile}
              className="h-11 flex-1 gap-2 rounded-xl bg-primary font-display text-sm uppercase tracking-[0.15em] text-primary-foreground hover:bg-primary/90"
            >
              <Save className="h-4 w-4" />
              Zapisz profil
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Zapisywane są tylko nazwa i ELO — nigdy hasło.
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
        eyebrow="Logowanie"
        title="Witaj z powrotem"
        description="Wybierz profil, aby kontynuować. Potrzebujesz tylko hasła."
        altPrompt="Nie masz konta?"
        altHref="/register"
        altLabel="Zarejestruj się"
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

          <Button
            variant="outline"
            onClick={() => setView({ kind: "form", selectedProfile: null })}
            className="h-16 w-full gap-3 rounded-2xl border-dashed text-xl"
          >
            <Plus className="h-6 w-6" />
            Zaloguj na inne konto
          </Button>
        </div>
      </AuthScreen>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Login Form
  // -------------------------------------------------------------------------

  return (
    <AuthScreen
      eyebrow="Logowanie"
      title="Zaloguj się"
      altPrompt="Nie masz konta?"
      altHref="/register"
      altLabel="Zarejestruj się"
    >
      <div className="space-y-8">
        {/* Back link */}
        {savedProfiles.length > 0 && (
          <button
            onClick={backToProfiles}
            className="flex items-center gap-2 text-lg text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
            Powrót do wyboru profilu
          </button>
        )}

        {/* Selected profile preview */}
        {selectedProfile && (
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-secondary p-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/20 font-display text-2xl text-primary">
              {selectedProfile.username[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-2xl font-semibold text-foreground">
                {selectedProfile.username}
              </div>
              <div className="flex items-center gap-2 text-lg text-muted-foreground">
                <Trophy className="h-5 w-5 text-accent" />
                {selectedProfile.elo_rating} ELO
              </div>
            </div>
          </div>
        )}

        {/* General error */}
        {generalError && (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-4 text-lg text-destructive">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Identifier field */}
          {!selectedProfile && (
            <div className="space-y-3">
              <Label htmlFor="identifier" className="text-lg">
                Nazwa użytkownika lub email
              </Label>
              <Input
                id="identifier"
                type="text"
                placeholder="dowódca lub dowódca@maplord.gg"
                autoComplete="username"
                className={`h-16 text-xl rounded-2xl ${errors.identifier ? "border-destructive" : ""}`}
                {...rhfRegister("identifier")}
              />
              {errors.identifier && (
                <p className="mt-2 text-base text-destructive">
                  {errors.identifier.message}
                </p>
              )}
            </div>
          )}

          {/* Password field */}
          <div className="space-y-3">
            <Label htmlFor="password" className="text-lg">Hasło</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus={!!selectedProfile}
              className={`h-16 text-xl rounded-2xl ${errors.password ? "border-destructive" : ""}`}
              {...rhfRegister("password")}
            />
            {errors.password && (
              <p className="mt-2 text-base text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="h-16 w-full rounded-2xl bg-primary font-display text-xl uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Logowanie..." : "Wejdź do gry"}
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
