import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";
import ChatWidget from "@/components/chat/ChatWidget";
import { QueryProvider } from "@/components/QueryProvider";
import { SystemModulesProvider } from "@/components/SystemModulesProvider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { ChatProvider } from "@/hooks/useChat";
import { SerwistProvider } from "./serwist-provider";

const uiSans = localFont({
  src: [
    {
      path: "../public/assets/fonts/Barlow-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Barlow-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Barlow-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Barlow-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-ui",
  display: "swap",
});

const displayFont = localFont({
  src: [
    {
      path: "../public/assets/fonts/Rajdhani-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Rajdhani-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Rajdhani-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/Rajdhani-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "https://zelqor.pl"),
  title: {
    default: "Zelqor — Strategiczna gra czasu rzeczywistego",
    template: "%s | Zelqor",
  },
  description:
    "Zelqor to strategiczna gra czasu rzeczywistego na mapie świata. Zdobywaj terytoria, buduj armie i rywalizuj z innymi graczami online.",
  keywords: ["gra strategiczna", "RTS", "mapa świata", "multiplayer", "gra online", "Zelqor"],
  authors: [{ name: "Zelqor Team" }],
  creator: "Zelqor",
  openGraph: {
    type: "website",
    siteName: "Zelqor",
    title: "Zelqor — Strategiczna gra czasu rzeczywistego",
    description: "Zdobywaj terytoria, buduj armie i rywalizuj z innymi graczami na mapie świata w czasie rzeczywistym.",
    locale: "pl_PL",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zelqor — Strategiczna gra czasu rzeczywistego",
    description: "Zdobywaj terytoria, buduj armie i rywalizuj z innymi graczami na mapie świata w czasie rzeczywistym.",
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Zelqor",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className="dark">
      <body className={`${uiSans.variable} ${displayFont.variable} antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Zelqor",
              description:
                "Strategiczna gra czasu rzeczywistego na mapie świata. Zdobywaj terytoria, buduj armie i rywalizuj online.",
              applicationCategory: "GameApplication",
              operatingSystem: "Web",
              offers: { "@type": "Offer", price: "0", priceCurrency: "PLN" },
              inLanguage: "pl",
            }),
          }}
        />
        <SerwistProvider swUrl="/serwist/sw.js">
          <QueryProvider>
            <AuthProvider>
              <SystemModulesProvider>
                <ChatProvider>
                  {children}
                  <ChatWidget />
                  <Toaster />
                </ChatProvider>
              </SystemModulesProvider>
            </AuthProvider>
          </QueryProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
