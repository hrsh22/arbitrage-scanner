"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const HeaderAuth = dynamic(() => import("./header-auth").then((mod) => mod.HeaderAuth), {
  ssr: false, // Wait for client side to prevent hydration mismatches with wallet state
  loading: () => <div className="h-9 w-[120px] animate-pulse rounded-[10px] bg-white/5" />,
});

interface HeaderProps {
  className?: string;
}

export function Header({ className }: HeaderProps) {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  return (
    <header
      className={`z-50 w-full shrink-0 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl supports-[backdrop-filter]:bg-slate-950/80 ${className ?? ""}`}
    >
      <div className="mx-auto grid min-h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-6 md:flex md:flex-nowrap md:justify-between md:gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link href="/" className="group flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] border border-[#656565] bg-[#121212] shadow-[0_0_15px_rgba(255,255,255,0.05)] transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.08)] sm:h-11 sm:w-11">
              <div className="absolute inset-1 rounded-[1px] bg-gradient-to-br from-white/10 to-transparent" />
              <div className="z-10 flex flex-col items-center gap-0.5">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-[1px] bg-white" />
                  <div className="h-1.5 w-1.5 rounded-[1px] bg-white" />
                </div>
                <div className="h-3 w-4 rounded-[1px] border border-white/80" />
              </div>
            </div>
            <div className="min-w-0 space-y-0.5">
              <span className="block truncate text-xs font-semibold uppercase tracking-wider text-white sm:text-sm sm:tracking-[0.24em]">
                Polymarket Vault
              </span>
              <span className="hidden text-xs text-slate-400 sm:block">Prediction Market Vaults</span>
            </div>
          </Link>

          <div className="ml-4 mr-2 hidden h-8 w-[1px] bg-white/10 md:block" />

          <nav className="hidden md:flex items-center">
            <Link
              href="/discover"
              className="rounded-[2px] border border-[#212121] bg-transparent px-4 py-1.5 text-sm font-medium text-[#828B8D] transition-colors hover:bg-[#121212] hover:text-white"
            >
              Discover Vaults
            </Link>
          </nav>
        </div>

        {!isHomePage && <HeaderAuth />}

        <nav className="col-span-2 flex w-full md:hidden">
          <Link
            href="/discover"
            className="inline-flex min-h-9 w-full items-center justify-center rounded-[2px] border border-[#212121] bg-[#121212]/80 px-3 py-1.5 text-xs font-medium text-[#C8D0D2] transition-colors hover:bg-[#1A1A1A] hover:text-white"
          >
            Discover Vaults
          </Link>
        </nav>
      </div>
    </header>
  );
}
