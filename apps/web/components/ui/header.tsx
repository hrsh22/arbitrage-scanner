"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, Clock, Repeat2, History, Activity } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

const navigation = [
  {
    name: "Cross-Platform",
    href: "/cross-platform",
    icon: Repeat2,
    description: "Poly↔Kalshi arbitrage",
  },
  {
    name: "Near Resolution",
    href: "/near-resolution",
    icon: Clock,
    description: "High-confidence markets",
  },
];

interface HeaderProps {
  activeOpportunities?: number;
}

export function Header({ activeOpportunities }: HeaderProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center px-4 md:px-8">
        {/* Logo & Title - fixed width */}
        <Link
          href="/"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity shrink-0"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-profit to-profit/70 text-profit-foreground">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-semibold tracking-tight">Arbitrage Scanner</h1>
            <p className="text-xs text-muted-foreground">Polymarket & Kalshi</p>
          </div>
        </Link>

        {/* Main Navigation - centered, takes available space */}
        <nav className="flex flex-1 items-center justify-center gap-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{item.name}</span>
              </Link>
            );
          })}

          {/* History Link */}
          <Link
            href="/cross-platform/history"
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/cross-platform/history"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <History className="h-4 w-4" />
            <span className="hidden md:inline">History</span>
          </Link>
        </nav>

        {/* Status Indicators - fixed width to prevent layout shift */}
        <div className="flex items-center justify-end gap-4 shrink-0 min-w-[120px] sm:min-w-[200px]">
          {activeOpportunities !== undefined && activeOpportunities > 0 ? (
            <div className="flex items-center gap-2 rounded-full bg-profit/10 px-3 py-1 text-sm text-profit">
              <Activity className="h-3.5 w-3.5" />
              <span className="font-medium">{activeOpportunities}</span>
              <span className="hidden sm:inline text-profit/70">active</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
              <span>Scanning...</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
