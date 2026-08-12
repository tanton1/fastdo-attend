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
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "FASTDO ATTEND — Chấm công đa lớp" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FASTDO ATTEND",
    description: "Chấm công đa lớp bằng khuôn mặt, vị trí và xác minh hiện diện tại cơ sở.",
    images: ["/og.png"],
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
