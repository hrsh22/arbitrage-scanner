import Link from "next/link";
import { Badge } from "@workspace/ui/components/badge";
import { ArrowRight } from "lucide-react";
import { getVaultHref } from "@/src/lib/vaultRouting";

const showcaseVaults = [
  {
    id: 1,
    slug: "sisyphus-vault",
    name: "Sisyphus Vault",
    category: "Vault",
    manager: "Sisyphus Agent",
    risk: "High",
    focus: "BTC 15m market",
    state: "Active",
  },
];

export function ShowcaseSection() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 bg-slate-950/50 px-4 py-16 sm:px-6 sm:py-24">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[500px] w-[1000px] bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.05)_0%,_transparent_70%)] blur-[60px] pointer-events-none" />

      <div className="mx-auto max-w-5xl relative z-10">
        <div className="mb-10 flex flex-col justify-between gap-6 sm:mb-12 md:flex-row md:items-end">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl mb-4">
              Discover Vaults
            </h2>
          </div>
          <Link
            href="/discover"
            className="inline-flex items-center gap-2 text-cyan-300 font-medium hover:text-cyan-200 transition-colors"
          >
            View all vaults <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex justify-center">
          {showcaseVaults.map((vault) => (
            <Link key={vault.name} href={getVaultHref(vault)} className="block w-full max-w-md">
              <div className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md transition-all hover:-translate-y-1 hover:bg-white/[0.06] sm:p-6">
                <div className="mb-6 flex items-start justify-between sm:mb-8">
                  <Badge
                    variant="outline"
                    className="border-white/10 bg-white/5 text-[10px] uppercase tracking-widest text-slate-300"
                  >
                    {vault.category}
                  </Badge>
                  <span className="text-sm font-medium text-cyan-200">{vault.state}</span>
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">{vault.name}</h3>
                <p className="text-sm leading-6 text-slate-300">
                  Agent-managed vault focused on {vault.focus}.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold uppercase text-white">
                      {vault.manager.charAt(0)}
                    </div>
                    <span className="text-xs text-slate-400">{vault.manager}</span>
                  </div>
                  <span className="text-xs text-slate-500">{vault.risk} Risk</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
