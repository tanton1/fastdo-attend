import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "FASTDO ATTEND — Chấm công thông minh",
  description: "Bản thử nghiệm PWA chấm công đa lớp bằng khuôn mặt, vị trí và xác minh hiện diện tại cơ sở.",
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
    description: "Chấm công đa lớp bằng khuôn mặt, vị trí và xác minh hiện diện tại cơ sở.",
    images: [{ url: "/og-phase7.png", width: 1731, height: 909, alt: "FASTDO ATTEND — Face AI, nhân sự và ca làm" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FASTDO ATTEND",
    description: "Chấm công đa lớp bằng khuôn mặt, vị trí và xác minh hiện diện tại cơ sở.",
    images: ["/og-phase7.png"],
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
