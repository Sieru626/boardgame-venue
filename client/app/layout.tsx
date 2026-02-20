import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, DotGothic16 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const dotGothic = DotGothic16({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  variable: "--font-dotgothic",
});

export const metadata: Metadata = {
  title: "New Game Order | ボードゲームの試運転会場",
  description: "ボードゲームの試運転会場 - オンラインでボードゲームを楽しもう",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${dotGothic.variable} font-dotgothic antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
