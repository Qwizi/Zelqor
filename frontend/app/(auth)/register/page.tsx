"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import AuthScreen from "@/components/auth/AuthScreen";
import SocialLoginButtons from "@/components/auth/SocialLoginButtons";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import { APIError } from "@/lib/api";

const registerSchema = z
  .object({
    username: z
      .string()
      .min(3, "Nazwa uzytkownika musi miec co najmniej 3 znaki")
      .max(30, "Nazwa uzytkownika moze miec maksymalnie 30 znakow")
      .regex(/^[a-zA-Z0-9_-]+$/, "Dozwolone znaki: litery, cyfry, _ i -"),
    email: z.string().min(1, "Email jest wymagany").email("Nieprawidlowy adres email"),
    password: z.string().min(8, "Haslo musi miec co najmniej 8 znakow"),
    confirmPassword: z.string().min(1, "Powtorz haslo"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Hasla nie sa identyczne",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

function getPasswordStrength(password: string): "none" | "weak" | "medium" | "strong" {
  if (!password) return "none";
  if (password.length < 8) return "weak";
  if (password.length < 12) return "medium";
  return "strong";
}

const strengthConfig = {
  none: { width: "0%", color: "" },
  weak: { width: "33%", color: "bg-red-500" },
  medium: { width: "66%", color: "bg-amber-500" },
  strong: { width: "100%", color: "bg-green-500" },
};

export default function RegisterPage() {
  const { enabled } = useModuleConfig("registration");
  if (!enabled) return <ModuleDisabledPage slug="registration" />;
  return <RegisterContent />;
}

function RegisterContent() {
  const { register: registerUser, user } = useAuth();
  const router = useRouter();
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  const {
    register: rhfRegister,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const passwordValue = watch("password", "");
  const strength = getPasswordStrength(passwordValue);

  const onSubmit = async (data: RegisterFormData) => {
    setGeneralError(null);
    try {
      await registerUser(data.username, data.email, data.password);
      toast.success("Konto utworzone!", { id: "auth-register-success" });
      router.push("/dashboard");
    } catch (err: unknown) {
      if (err instanceof APIError) {
        if (err.status === 400 && err.body && typeof err.body === "object") {
          const body = err.body as Record<string, unknown>;
          let hasFieldError = false;

          const emailMsg = Array.isArray(body.email) ? body.email[0] : String(body.email ?? "");
          const usernameMsg = Array.isArray(body.username) ? body.username[0] : String(body.username ?? "");

          if (body.email && emailMsg.toLowerCase().includes("zajety")) {
            setError("email", { message: "Ten adres email jest juz zajety" });
            hasFieldError = true;
          } else if (body.email) {
            setError("email", { message: emailMsg });
            hasFieldError = true;
          }

          if (body.username && usernameMsg.toLowerCase().includes("zajeta")) {
            setError("username", {
              message: "Ta nazwa uzytkownika jest juz zajeta",
            });
            hasFieldError = true;
          } else if (body.username) {
            setError("username", { message: usernameMsg });
            hasFieldError = true;
          }

          if (body.password) {
            const passwordMsg = Array.isArray(body.password) ? body.password[0] : String(body.password);
            setError("password", { message: passwordMsg });
            hasFieldError = true;
          }

          if (!hasFieldError) {
            setGeneralError("Wystapil blad podczas rejestracji. Sprobuj ponownie.");
          }
        } else {
          setGeneralError("Wystapil blad podczas rejestracji. Sprobuj ponownie.");
        }
      } else {
        setGeneralError("Wystapil blad podczas rejestracji. Sprobuj ponownie.");
        toast.error("Wystapil nieoczekiwany blad", { id: "auth-register-error" });
      }
    }
  };

  return (
    <AuthScreen
      eyebrow="Rejestracja"
      title="Nowe konto"
      description="Utwórz profil i zacznij walkę o dominację na mapie świata."
      altPrompt="Masz już konto?"
      altHref="/login"
      altLabel="Zaloguj się"
    >
      <div className="space-y-5 md:space-y-8">
        {generalError && (
          <div className="rounded-xl md:rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 md:px-6 md:py-4 text-sm md:text-sm text-destructive">
            {generalError}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 md:space-y-6">
          <div className="space-y-2 md:space-y-3">
            <Label htmlFor="username" className="text-sm md:text-sm">
              Nazwa użytkownika
            </Label>
            <Input
              id="username"
              placeholder="Strateg42"
              autoComplete="username"
              className={`h-12 md:h-14 text-base md:text-lg rounded-xl md:rounded-xl ${errors.username ? "border-destructive" : ""}`}
              {...rhfRegister("username")}
            />
            {errors.username && <p className="text-xs md:text-base text-destructive">{errors.username.message}</p>}
          </div>
          <div className="space-y-2 md:space-y-3">
            <Label htmlFor="email" className="text-sm md:text-sm">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="dowódca@maplord.gg"
              autoComplete="email"
              className={`h-12 md:h-14 text-base md:text-lg rounded-xl md:rounded-xl ${errors.email ? "border-destructive" : ""}`}
              {...rhfRegister("email")}
            />
            {errors.email && <p className="text-xs md:text-base text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2 md:space-y-3">
            <Label htmlFor="password" className="text-sm md:text-sm">
              Hasło
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="min. 8 znaków"
              autoComplete="new-password"
              className={`h-12 md:h-14 text-base md:text-lg rounded-xl md:rounded-xl ${errors.password ? "border-destructive" : ""}`}
              {...rhfRegister("password")}
            />
            {passwordValue && strength !== "none" && (
              <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 w-full rounded-full bg-secondary">
                <div
                  className={`h-1.5 md:h-2 rounded-full transition-all duration-300 ${strengthConfig[strength].color}`}
                  style={{ width: strengthConfig[strength].width }}
                />
              </div>
            )}
            {errors.password && <p className="text-xs md:text-base text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2 md:space-y-3">
            <Label htmlFor="confirmPassword" className="text-sm md:text-sm">
              Powtórz hasło
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              className={`h-12 md:h-14 text-base md:text-lg rounded-xl md:rounded-xl ${errors.confirmPassword ? "border-destructive" : ""}`}
              {...rhfRegister("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs md:text-base text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>
          <Button
            type="submit"
            className="h-12 md:h-14 w-full rounded-full md:rounded-xl bg-primary font-display text-base md:text-lg uppercase tracking-wider text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Rejestracja..." : "Utwórz konto"}
          </Button>
        </form>

        <SocialLoginButtons />
      </div>
    </AuthScreen>
  );
}
