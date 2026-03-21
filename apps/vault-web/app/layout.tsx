import type { Metadata } from "next";
import { DM_Mono } from "next/font/google";

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

export const metadata: Metadata = {
  title: "Polymarket Vault",
  description:
    "Dark-mode vault dashboard for cycle-based deposits, exits, and settlement tracking.",
  keywords: ["vault", "polymarket", "dashboard", "settlement", "polygon"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${mono.variable} h-screen bg-background font-sans text-foreground antialiased selection:bg-cyan-300/30 selection:text-white`}
      >
        <Providers>
          <div className="relative flex h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(236,102,0,0.15),_transparent_28%),radial-gradient(circle_at_80%_12%,_rgba(137,145,130,0.165),_transparent_18%),linear-gradient(180deg,_#0A0A0A,_#111112)]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25" />
            <Header />
            <div className="relative flex flex-1 min-h-0 flex-col">{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
