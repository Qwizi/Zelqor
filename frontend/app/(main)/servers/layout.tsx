import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Serwery spolecznosci",
  description: "Przegladaj i dolacz do serwerow spolecznosci Zelqor. Znajdz serwer w swoim regionie.",
};

export default function ServersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
