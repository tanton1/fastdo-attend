import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "FASTDO ATTEND — Pilot Control & Realtime",
  description: "PWA chấm công đa lớp với Face AI, chính sách pilot theo chi nhánh, báo cáo và giám sát realtime.",
  applicationName: "FASTDO ATTEND",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    title: "FASTDO ATTEND",
    description: "Face AI, Pilot Control, báo cáo và giám sát chấm công realtime theo chi nhánh.",
    images: [{ url: "/og-phase8.png", width: 1731, height: 909, alt: "FASTDO ATTEND — Pilot Control, Realtime và Privacy" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FASTDO ATTEND",
    description: "Face AI, Pilot Control, báo cáo và giám sát chấm công realtime theo chi nhánh.",
    images: ["/og-phase8.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#070909",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
