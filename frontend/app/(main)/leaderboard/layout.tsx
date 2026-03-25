import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ranking graczy",
  description: "Ranking najlepszych graczy MapLord. Sprawdz kto dominuje na mapie swiata.",
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
