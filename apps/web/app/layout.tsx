import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "@workspace/ui/globals.css";
import { Providers } from "@/components/providers";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Arbitrage Scanner | Polymarket & Kalshi",
  description:
    "Find guaranteed profit opportunities with cross-platform arbitrage between Polymarket and Kalshi prediction markets.",
  keywords: ["polymarket", "kalshi", "arbitrage", "prediction markets", "trading"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontSans.variable} ${fontMono.variable} font-sans antialiased min-h-screen bg-background`}
      >
        <Providers>
          <div className="relative flex min-h-screen flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
