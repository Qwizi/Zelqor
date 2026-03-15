import type { Metadata } from "next";
import type { ReactNode } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.API_URL ||
  "http://backend:8000/api/v1";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  try {
    const res = await fetch(`${API_BASE}/share/${token}/`, {
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return {
        title: "MapLord — Udostępniony mecz",
        description: "Zobacz wyniki meczu w MapLord",
      };
    }

    const data = await res.json();
    const match = data.match;
    const result = data.result;
    const winner = match?.players?.find(
      (p: { user_id: string }) => p.user_id === match.winner_id
    );

    const title = winner
      ? `MapLord — ${winner.username} wygrał!`
      : "MapLord — Wyniki meczu";

    const playerNames = match?.players
      ?.map((p: { username: string }) => p.username)
      .join(" vs ");

    const description = result
      ? `${playerNames} · ${Math.floor(result.duration_seconds / 60)} min · ${match.players.length} graczy`
      : `${playerNames} · ${match.players.length} graczy`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "MapLord",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return {
      title: "MapLord — Udostępniony mecz",
      description: "Zobacz wyniki meczu w MapLord",
    };
  }
}

export default function ShareLayout({ children }: { children: ReactNode }) {
  return children;
}
