import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, DM_Mono, Manrope } from "next/font/google";

import "@workspace/ui/globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";

const sans = DM_Mono({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = DM_Mono({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
});

const serif = Cormorant_Garamond({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-serif",
});

const landingSans = Manrope({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-landing-sans",
});

export const metadata: Metadata = {
  title: "Polymarket Vault",
  description: "Allocate capital into prediction market strategy vaults.",
  keywords: ["vault", "polymarket", "dashboard", "settlement", "prediction markets"],
  icons: {
    icon: "/logo/vault-platform.svg",
    shortcut: "/logo/vault-platform.svg",
    apple: "/logo/vault-platform.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${mono.variable} ${serif.variable} ${landingSans.variable} min-h-[100dvh] overflow-x-hidden bg-background font-sans text-foreground antialiased selection:bg-[#E8C08C]/30 selection:text-white`}
      >
        <Providers>
          <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-[radial-gradient(circle_at_18%_2%,_rgba(217,70,239,0.07),_transparent_16%),radial-gradient(circle_at_86%_8%,_rgba(34,211,238,0.06),_transparent_15%),linear-gradient(180deg,_#020204,_#070708_48%,_#0A0A0A)]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25" />
            <Header />
            <div className="relative flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
