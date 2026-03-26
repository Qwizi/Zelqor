import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dokumentacja API",
  description: "Dokumentacja API MapLord dla deweloperow. Integruj swoje aplikacje z platforma MapLord.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
