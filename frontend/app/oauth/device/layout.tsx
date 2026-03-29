import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Autoryzacja urządzenia",
  description: "Autoryzuj urządzenie, aby połączyć je z kontem Zelqor.",
};

export default function OAuthDeviceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
