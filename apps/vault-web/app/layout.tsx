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
        className={`${sans.variable} ${mono.variable} ${serif.variable} ${landingSans.variable} min-h-[100dvh] overflow-x-hidden bg-[#FAF8F5] font-sans text-[#1A202C] antialiased selection:bg-[#E8C08C]/30 selection:text-[#1A202C]`}
      >
        <Providers>
          <div
            className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-[#FAF8F5] bg-top bg-no-repeat"
            style={{
              backgroundImage:
                "linear-gradient(to bottom, rgba(204, 194, 178, 0.42) 0px, rgba(225, 218, 205, 0.58) 220px, rgba(243, 239, 232, 0.9) 390px, #FAF8F5 560px), url('/background/polyvaults-header-bg.png')",
              backgroundSize: "100% 100%, 100% auto",
            }}
          >
            <Header />
            <div className="relative z-10 flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
