import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zainstaluj Zelqor CLI",
  description: "Pobierz i zainstaluj Zelqor CLI - narzedzie wiersza polecen do zarzadzania serwerami i pluginami.",
};

export default function CliLayout({ children }: { children: React.ReactNode }) {
  return children;
}
