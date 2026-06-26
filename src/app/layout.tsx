import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Конструктор опросов 2.0",
  description: "Конструктор опросов с ролями, версиями, публикацией, результатами и аналитикой.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${manrope.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-full bg-[radial-gradient(circle_at_top,#eff6ff,transparent_34%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_52%,#f7fbff_100%)] text-slate-900 antialiased">
        <div className="relative min-h-screen overflow-x-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-[-160px] h-[360px] bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.16),transparent_62%)]" />
          <div className="pointer-events-none absolute right-[-160px] top-40 h-[320px] w-[320px] rounded-full bg-sky-200/20 blur-3xl" />
          <div className="pointer-events-none absolute left-[-180px] bottom-10 h-[320px] w-[320px] rounded-full bg-blue-200/20 blur-3xl" />
          {children}
        </div>
      </body>
    </html>
  );
}
