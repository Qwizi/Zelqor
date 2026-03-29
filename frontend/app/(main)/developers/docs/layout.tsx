import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dokumentacja API",
  description: "Dokumentacja API Zelqor dla deweloperow. Integruj swoje aplikacje z platforma Zelqor.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
