import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Nie znaleziono strony",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="font-display text-6xl font-bold text-foreground sm:text-8xl">404</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Strona, ktorej szukasz, nie istnieje lub zostala przeniesiona.
      </p>
      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-6 py-3 font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Panel glowny
        </Link>
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 font-medium text-foreground transition-colors hover:bg-muted"
        >
          Ranking
        </Link>
      </div>
    </div>
  );
}
