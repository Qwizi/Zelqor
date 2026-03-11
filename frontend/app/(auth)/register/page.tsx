"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthScreen from "@/components/auth/AuthScreen";
import { toast } from "sonner";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(username, email, password);
      toast.success("Konto utworzone!");
      router.push("/dashboard");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Błąd rejestracji"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen
      eyebrow="Recruitment"
      title="Nowe konto"
      description="Utworz profil dowodcy i od razu przejdz do dashboardu z matchmakingiem, ranga i dalszymi ekranami gry."
      altPrompt="Masz juz konto?"
      altHref="/login"
      altLabel="Zaloguj się"
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
          Konto daje dostep do meczow rankingowych, historii gier i dalszych
          paneli, ktore mozemy potem podpiac pod assety `match_making`,
          `ranks` i `badges`.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-slate-300">
              Nazwa użytkownika
            </Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Strateg42"
              required
              autoComplete="username"
              className="h-11 rounded-xl border-white/10 bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-300">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dowodca@maplord.gg"
              required
              autoComplete="email"
              className="h-11 rounded-xl border-white/10 bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300">
              Hasło
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min. 8 znaków"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-11 rounded-xl border-white/10 bg-slate-900/80 px-4 text-zinc-100 placeholder:text-slate-500"
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full rounded-xl border border-amber-300/30 bg-[linear-gradient(135deg,#f59e0b,#fbbf24)] font-display text-sm uppercase tracking-[0.22em] text-slate-950 hover:opacity-95"
            disabled={loading}
          >
            {loading ? "Rejestracja..." : "Utworz konto"}
          </Button>
        </form>
      </div>
    </AuthScreen>
  );
}
