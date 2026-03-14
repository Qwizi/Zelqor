import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/sonner";
import { ChatProvider } from "@/hooks/useChat";
import { MatchChatProvider } from "@/contexts/MatchContext";
import ChatWidget from "@/components/chat/ChatWidget";

const uiSans = localFont({
  src: [
    {
      path: "../public/assets/fonts/SF-Pro-Display-Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/SF-Pro-Display-Semibold.otf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/SF-Pro-Display-Bold.otf",
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
      path: "../public/assets/fonts/ChakraPetch-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/ChakraPetch-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../public/assets/fonts/ChakraPetch-Bold.ttf",
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
        <AuthProvider>
          <ChatProvider>
            <MatchChatProvider>
              {children}
              <ChatWidget />
              <Toaster />
            </MatchChatProvider>
          </ChatProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
