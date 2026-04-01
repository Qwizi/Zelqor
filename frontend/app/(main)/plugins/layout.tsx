import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pluginy",
  description: "Przegladaj i instaluj pluginy spolecznosci rozszerzajace funkcjonalnosc serwerow Zelqor.",
};

export default function PluginsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
