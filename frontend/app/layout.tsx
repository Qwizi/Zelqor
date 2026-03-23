import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/sonner";
import { ChatProvider } from "@/hooks/useChat";
import ChatWidget from "@/components/chat/ChatWidget";
import { SerwistProvider } from "./serwist-provider";
import { SystemModulesProvider } from "@/components/SystemModulesProvider";
import { QueryProvider } from "@/components/QueryProvider";

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
  title: "MapLord",
  description: "Real-time strategy game on a world map",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MapLord",
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
    <html lang="en" className="dark">
      <body
        className={`${uiSans.variable} ${displayFont.variable} antialiased`}
      >
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
