"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const HeaderAuth = dynamic(() => import("./header-auth").then((mod) => mod.HeaderAuth), {
  ssr: false, // Wait for client side to prevent hydration mismatches with wallet state
  loading: () => <div className="h-8 w-[120px] animate-pulse rounded-full bg-[#F1EEE8]" />,
});

interface HeaderProps {
  className?: string;
}

export function Header({ className }: HeaderProps) {
  const pathname = usePathname();
  const isHomePage = pathname === "/";
  const vaultNavActive = pathname.startsWith("/discover") || pathname.startsWith("/vault");

  if (isHomePage) {
    return null;
  }

  return (
    <header
      className={`relative z-50 w-full shrink-0 bg-transparent text-[#1A202C] ${className ?? ""}`}
    >
      <div className="mx-auto grid min-h-10 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-0 sm:px-8 md:flex md:flex-nowrap md:justify-between md:gap-8">
        <div className="flex min-w-0 items-center gap-4 sm:gap-8">
          <Link href="/" className="group flex min-w-0 items-center gap-2.5">
            <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[#1A202C] transition-transform duration-300 group-hover:-translate-y-0.5">
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex gap-0.5">
                  <div className="h-1 w-1 rounded-[1px] bg-[#FAF8F5]" />
                  <div className="h-1 w-1 rounded-[1px] bg-[#FAF8F5]" />
                </div>
                <div className="h-2 w-3 rounded-[1px] border border-[#FAF8F5]/85" />
              </div>
            </div>
            <div className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight text-[#1A202C]">
                Polymarket Vault
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center">
            <Link
              href="/discover"
              className={`text-sm font-bold underline-offset-4 transition-colors hover:text-[#302B2C] ${
                vaultNavActive ? "text-[#302B2C] underline" : "text-[#61604E]"
              }`}
            >
              Discover Vaults
            </Link>
          </nav>
        </div>

        <HeaderAuth />

        <nav className="col-span-2 flex w-full md:hidden">
          <Link
            href="/discover"
            className={`inline-flex min-h-8 w-full items-center justify-center rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
              vaultNavActive
                ? "border-[#D4A574] bg-[#E8C08C] text-[#302B2C]"
                : "border-[#CCCAC4] bg-[#F1EEE8] text-[#61604E] hover:border-[#D4A574] hover:bg-[#E8C08C] hover:text-[#302B2C]"
            }`}
          >
            Discover Vaults
          </Link>
        </nav>
      </div>
    </header>
  );
}
