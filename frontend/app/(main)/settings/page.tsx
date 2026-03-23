"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useLinkedSocialAccounts } from "@/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getSocialAuthURL,
  unlinkSocialAccount,
  setPassword,
  changePassword,
  type SocialAccountOut,
} from "@/lib/api";
import { requireToken } from "@/lib/queryClient";
import { toast } from "sonner";
import {
  User,
  Lock,
  Gamepad2,
  Bell,
  AlertTriangle,
  CheckCircle2,
  LogOut,
  Link2,
  Unlink,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { SettingsSkeleton } from "@/components/skeletons/SettingsSkeleton";

// --- Zod schemas ---

const setPasswordSchema = z
  .object({
    new_password: z.string().min(8, "Hasło musi mieć co najmniej 8 znaków"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Hasła nie są identyczne",
    path: ["confirm_password"],
  });

const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Podaj aktualne hasło"),
    new_password: z.string().min(8, "Hasło musi mieć co najmniej 8 znaków"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Hasła nie są identyczne",
    path: ["confirm_password"],
  });

type SetPasswordValues = z.infer<typeof setPasswordSchema>;
type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

// --- Sub-components ---

function PasswordInput({
  id,
  placeholder,
  disabled,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={visible ? "Ukryj hasło" : "Pokaż hasło"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

function SetPasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordValues>({ resolver: zodResolver(setPasswordSchema) });

  async function onSubmit(values: SetPasswordValues) {
    try {
      await setPassword(requireToken(), values.new_password);
      toast.success("Hasło zostało ustawione.");
      reset();
      onSuccess();
    } catch {
      toast.error("Nie udało się ustawić hasła. Spróbuj ponownie.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
      <div>
        <label htmlFor="new_password" className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
          Nowe hasło
        </label>
        <div className="mt-1.5">
          <PasswordInput id="new_password" placeholder="co najmniej 8 znaków" disabled={isSubmitting} {...register("new_password")} />
        </div>
        <FieldError message={errors.new_password?.message} />
      </div>

      <div>
        <label htmlFor="confirm_password" className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
          Potwierdź hasło
        </label>
        <div className="mt-1.5">
          <PasswordInput id="confirm_password" placeholder="powtórz hasło" disabled={isSubmitting} {...register("confirm_password")} />
        </div>
        <FieldError message={errors.confirm_password?.message} />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
        Ustaw hasło
      </button>
    </form>
  );
}

function ChangePasswordForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  async function onSubmit(values: ChangePasswordValues) {
    try {
      await changePassword(requireToken(), values.current_password, values.new_password);
      toast.success("Hasło zostało zmienione.");
      reset();
    } catch {
      toast.error("Nie udało się zmienić hasła. Sprawdź aktualne hasło i spróbuj ponownie.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
      <div>
        <label htmlFor="current_password" className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
          Aktualne hasło
        </label>
        <div className="mt-1.5">
          <PasswordInput id="current_password" placeholder="twoje aktualne hasło" disabled={isSubmitting} {...register("current_password")} />
        </div>
        <FieldError message={errors.current_password?.message} />
      </div>

      <div>
        <label htmlFor="new_password" className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
          Nowe hasło
        </label>
        <div className="mt-1.5">
          <PasswordInput id="new_password" placeholder="co najmniej 8 znaków" disabled={isSubmitting} {...register("new_password")} />
        </div>
        <FieldError message={errors.new_password?.message} />
      </div>

      <div>
        <label htmlFor="confirm_password" className="text-xs uppercase tracking-[0.18em] text-muted-foreground font-medium">
          Potwierdź nowe hasło
        </label>
        <div className="mt-1.5">
          <PasswordInput id="confirm_password" placeholder="powtórz nowe hasło" disabled={isSubmitting} {...register("confirm_password")} />
        </div>
        <FieldError message={errors.confirm_password?.message} />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
        Zmień hasło
      </button>
    </form>
  );
}

export default function SettingsPage() {
  const { user, loading, logout, refreshUser } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { permission, subscribed, subscribe, unsubscribe } = usePushNotifications();
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [linkingProvider, setLinkingProvider] = useState<"google" | "discord" | null>(null);

  const { data: socialAccounts = [], isLoading: socialLoading } = useLinkedSocialAccounts();

  if (loading) return <SettingsSkeleton />;

  if (!user) {
    router.replace("/login");
    return null;
  }

  async function handleUnlink(account: SocialAccountOut) {
    setUnlinkingId(account.id);
    try {
      await unlinkSocialAccount(requireToken(), account.id);
      await queryClient.invalidateQueries({ queryKey: [...queryKeys.auth.all, "social-accounts"] });
      toast.success(`Konto ${account.provider === "google" ? "Google" : "Discord"} zostało odłączone.`);
    } catch {
      toast.error("Nie udało się odłączyć konta.");
    } finally {
      setUnlinkingId(null);
    }
  }

  async function handleLink(provider: "google" | "discord") {
    setLinkingProvider(provider);
    try {
      const redirectUri = `${window.location.origin}/auth/link/${provider}`;
      const { url } = await getSocialAuthURL(provider, redirectUri);
      window.location.href = url;
    } catch {
      toast.error(`Nie udało się połączyć z ${provider === "google" ? "Google" : "Discord"}.`);
      setLinkingProvider(null);
    }
  }

  return (
    <div className="animate-page-in space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
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

        {user.has_password ? (
          <>
            <p className="text-sm text-muted-foreground">
              Zmień hasło do swojego konta
            </p>
            <ChangePasswordForm />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Twoje konto nie ma jeszcze hasła. Ustaw hasło, aby móc logować się
              bezpośrednio emailem i hasłem.
            </p>
            <SetPasswordForm onSuccess={refreshUser} />
          </>
        )}
      </section>

      {/* Connected accounts section */}
      <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-secondary">
            <Link2 className="h-4 w-4 text-indigo-300" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
            Podłączone konta
          </p>
        </div>

        <div className="space-y-3">
          {socialLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Ładowanie...</span>
            </div>
          ) : (
            <>
              {/* Google */}
              {(() => {
                const google = socialAccounts.find((a) => a.provider === "google");
                return (
                  <div className="hover-lift flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-foreground">Google</p>
                        {google ? (
                          <p className="text-xs text-muted-foreground">
                            {google.display_name || google.email}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Niepodłączone</p>
                        )}
                      </div>
                    </div>
                    {google ? (
                      <button
                        onClick={() => handleUnlink(google)}
                        disabled={unlinkingId === google.id}
                        className="flex w-fit items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground hover:bg-secondary/80 transition-colors"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        {unlinkingId === google.id ? "..." : "Odłącz"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLink("google")}
                        disabled={linkingProvider !== null}
                        className="flex w-fit items-center gap-2 rounded-xl border border-indigo-400/30 bg-indigo-500/15 px-4 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {linkingProvider === "google" ? "..." : "Podłącz"}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Discord */}
              {(() => {
                const discord = socialAccounts.find((a) => a.provider === "discord");
                return (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-3">
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" fill="#5865F2"/>
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-foreground">Discord</p>
                        {discord ? (
                          <p className="text-xs text-muted-foreground">
                            {discord.display_name || discord.email}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Niepodłączone</p>
                        )}
                      </div>
                    </div>
                    {discord ? (
                      <button
                        onClick={() => handleUnlink(discord)}
                        disabled={unlinkingId === discord.id}
                        className="flex w-fit items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm text-muted-foreground hover:bg-secondary/80 transition-colors"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        {unlinkingId === discord.id ? "..." : "Odłącz"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLink("discord")}
                        disabled={linkingProvider !== null}
                        className="flex w-fit items-center gap-2 rounded-xl border border-indigo-400/30 bg-indigo-500/15 px-4 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {linkingProvider === "discord" ? "..." : "Podłącz"}
                      </button>
                    )}
                  </div>
                );
              })()}
            </>
          )}
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
