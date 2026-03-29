import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rejestracja",
  description: "Zaloz konto w Zelqor i zacznij zdobywac terytoria na mapie swiata.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
