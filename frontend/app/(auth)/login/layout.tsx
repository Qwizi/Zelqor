import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zaloguj sie",
  description: "Zaloguj sie do Zelqor i dolacz do strategicznych bitew na mapie swiata.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
