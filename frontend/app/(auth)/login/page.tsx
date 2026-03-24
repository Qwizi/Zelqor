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
import SocialLoginButtons from "@/components/auth/SocialLoginButtons";
import { toast } from "sonner";
import { APIError, BannedError, type User } from "@/lib/api";
import { Plus, X, ArrowLeft, Save, SkipForward } from "lucide-react";

// ---------------------------------------------------------------------------
// Saved profiles — stored in localStorage, no passwords
// ---------------------------------------------------------------------------

interface SavedProfile {
  username: string;
  email: string;
  avatar: string | null;
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
      className="group flex w-full cursor-pointer items-center gap-3 md:gap-4 rounded-2xl border border-border bg-secondary p-3.5 md:p-5 text-left transition-all hover:border-border/60 hover:bg-muted active:scale-[0.98]"
    >
      <div className="flex h-11 w-11 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-full bg-primary/20 font-display text-lg md:text-2xl text-primary">
        {profile.username[0].toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base md:text-xl font-semibold text-foreground">
          {profile.username}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(profile.username);
        }}
        className="rounded-lg p-1.5 text-muted-foreground opacity-100 md:opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
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

  const isBannedParam = searchParams.get("banned") === "1";

  // Redirect if already logged in (but not during save-prompt / auto-save flow)
  useEffect(() => {
    if (user && view.kind !== "save-prompt" && view.kind !== "auto-save") {
      router.replace("/dashboard");
    }
  }, [user, router, view.kind]);

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
      toast.success("Profil zapisany", { id: "auth-profile-save" });
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
      if (err instanceof BannedError) {
        setGeneralError("Twoje konto zostało zbanowane za oszustwo.");
        return;
      }
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
            className="h-12 md:h-16 w-full gap-2 md:gap-3 rounded-2xl border-dashed text-sm md:text-xl"
          >
            <Plus className="h-4 w-4 md:h-6 md:w-6" />
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
      <div className="space-y-5 md:space-y-8">
        {/* Back link */}
        {savedProfiles.length > 0 && (
          <button
            onClick={backToProfiles}
            className="flex items-center gap-1.5 md:gap-2 text-sm md:text-sm text-muted-foreground transition-colors hover:text-foreground active:scale-[0.97]"
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
            Powrót
          </button>
        )}

        {/* Selected profile preview */}
        {selectedProfile && (
          <div className="flex items-center gap-3 md:gap-4 rounded-2xl border border-border bg-secondary p-3.5 md:p-5">
            <div className="flex h-11 w-11 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-full bg-primary/20 font-display text-lg md:text-2xl text-primary">
              {selectedProfile.username[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg md:text-2xl font-semibold text-foreground">
                {selectedProfile.username}
              </div>
            </div>
          </div>
        )}

        {/* Ban notice — shown when redirected from game with ?banned=1 */}
        {isBannedParam && !generalError && (
          <div className="rounded-xl md:rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 md:px-6 md:py-4 text-sm text-destructive font-medium">
            Twoje konto zostało zbanowane za oszustwo.
          </div>
        )}

        {/* General error */}
        {generalError && (
          <div className="rounded-xl md:rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 md:px-6 md:py-4 text-sm md:text-sm text-destructive">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 md:space-y-6">
          {/* Identifier field */}
          {!selectedProfile && (
            <div className="space-y-2 md:space-y-3">
              <Label htmlFor="identifier" className="text-sm md:text-sm">
                Login lub email
              </Label>
              <Input
                id="identifier"
                type="text"
                placeholder="dowódca@maplord.gg"
                autoComplete="username"
                className={`h-12 md:h-14 text-base md:text-lg rounded-xl md:rounded-xl ${errors.identifier ? "border-destructive" : ""}`}
                {...rhfRegister("identifier")}
              />
              {errors.identifier && (
                <p className="text-xs md:text-base text-destructive">
                  {errors.identifier.message}
                </p>
              )}
            </div>
          )}

          {/* Password field */}
          <div className="space-y-2 md:space-y-3">
            <Label htmlFor="password" className="text-sm md:text-sm">Hasło</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus={!!selectedProfile}
              className={`h-12 md:h-14 text-base md:text-lg rounded-xl md:rounded-xl ${errors.password ? "border-destructive" : ""}`}
              {...rhfRegister("password")}
            />
            {errors.password && (
              <p className="text-xs md:text-base text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="h-12 md:h-14 w-full rounded-full md:rounded-xl bg-primary font-display text-base md:text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Logowanie..." : "Wejdź do gry"}
          </Button>
        </form>

        <SocialLoginButtons />
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
