"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthScreen from "@/components/auth/AuthScreen";
import { toast } from "sonner";
import { APIError } from "@/lib/api";

const registerSchema = z
  .object({
    username: z
      .string()
      .min(3, "Nazwa uzytkownika musi miec co najmniej 3 znaki")
      .max(30, "Nazwa uzytkownika moze miec maksymalnie 30 znakow")
      .regex(/^[a-zA-Z0-9_-]+$/, "Dozwolone znaki: litery, cyfry, _ i -"),
    email: z
      .string()
      .min(1, "Email jest wymagany")
      .email("Nieprawidlowy adres email"),
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
  const { register: registerUser } = useAuth();
  const router = useRouter();
  const [generalError, setGeneralError] = useState<string | null>(null);

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
      toast.success("Konto utworzone!");
      router.push("/dashboard");
    } catch (err: unknown) {
      if (err instanceof APIError) {
        if (err.status === 400 && err.body && typeof err.body === "object") {
          const body = err.body as Record<string, unknown>;
          let hasFieldError = false;

          const emailMsg = Array.isArray(body.email) ? body.email[0] : String(body.email ?? "");
          const usernameMsg = Array.isArray(body.username)
            ? body.username[0]
            : String(body.username ?? "");

          if (
            body.email &&
            emailMsg.toLowerCase().includes("zajety")
          ) {
            setError("email", { message: "Ten adres email jest juz zajety" });
            hasFieldError = true;
          } else if (body.email) {
            setError("email", { message: emailMsg });
            hasFieldError = true;
          }

          if (
            body.username &&
            usernameMsg.toLowerCase().includes("zajeta")
          ) {
            setError("username", {
              message: "Ta nazwa uzytkownika jest juz zajeta",
            });
            hasFieldError = true;
          } else if (body.username) {
            setError("username", { message: usernameMsg });
            hasFieldError = true;
          }

          if (body.password) {
            const passwordMsg = Array.isArray(body.password)
              ? body.password[0]
              : String(body.password);
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
        toast.error("Wystapil nieoczekiwany blad");
      }
    }
  };

  return (
    <AuthScreen
      eyebrow="Recruitment"
      title="Nowe konto"
      description="Utworz profil dowodcy i zacznij walke o dominacje na mapie swiata."
      altPrompt="Masz juz konto?"
      altHref="/login"
      altLabel="Zaloguj sie"
    >
      <div className="space-y-5">
        {generalError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {generalError}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-slate-300">
              Nazwa uzytkownika
            </Label>
            <Input
              id="username"
              placeholder="Strateg42"
              autoComplete="username"
              className={`h-11 rounded-xl bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500 ${
                errors.username ? "border-red-500/40" : "border-white/10"
              }`}
              {...rhfRegister("username")}
            />
            {errors.username && (
              <p className="text-xs text-red-400 mt-1">{errors.username.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-300">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="dowodca@maplord.gg"
              autoComplete="email"
              className={`h-11 rounded-xl bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500 ${
                errors.email ? "border-red-500/40" : "border-white/10"
              }`}
              {...rhfRegister("email")}
            />
            {errors.email && (
              <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300">
              Haslo
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="min. 8 znakow"
              autoComplete="new-password"
              className={`h-11 rounded-xl bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500 ${
                errors.password ? "border-red-500/40" : "border-white/10"
              }`}
              {...rhfRegister("password")}
            />
            {passwordValue && strength !== "none" && (
              <div className="mt-1.5 h-1 w-full rounded-full bg-slate-700/60">
                <div
                  className={`h-1 rounded-full transition-all duration-300 ${strengthConfig[strength].color}`}
                  style={{ width: strengthConfig[strength].width }}
                />
              </div>
            )}
            {errors.password && (
              <p className="text-xs text-red-400 mt-1">{errors.password.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-slate-300">
              Powtorz haslo
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              className={`h-11 rounded-xl bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500 ${
                errors.confirmPassword ? "border-red-500/40" : "border-white/10"
              }`}
              {...rhfRegister("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-red-400 mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>
          <Button
            type="submit"
            className="h-11 w-full rounded-xl border border-amber-300/30 bg-[linear-gradient(135deg,#f59e0b,#fbbf24)] font-display text-sm uppercase tracking-[0.22em] text-slate-950 hover:opacity-95"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Rejestracja..." : "Utworz konto"}
          </Button>
        </form>
      </div>
    </AuthScreen>
  );
}
