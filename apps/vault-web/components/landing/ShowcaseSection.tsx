import Link from "next/link";
import { Badge } from "@workspace/ui/components/badge";
import { ArrowRight } from "lucide-react";

const showcaseVaults = [
  {
    name: "Sisyphus Vault",
    category: "Strategy",
    manager: "Sisyphus Agent",
    risk: "High",
    performance: "+28.1%",
    type: "agent",
  },
];

export function ShowcaseSection() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 bg-slate-950/50 px-4 py-24 sm:px-6">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[500px] w-[1000px] bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.05)_0%,_transparent_70%)] blur-[60px] pointer-events-none" />
      
      <div className="mx-auto max-w-5xl relative z-10">
        <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl mb-4">
              Explore indices and strategy vaults
            </h2>
            <p className="text-slate-400 max-w-xl">
              Preview the types of vaults available on PM Vaults. Dive into real strategies and
              track their live performance.
            </p>
          </div>
          <Link
            href="/discover"
            className="inline-flex items-center gap-2 text-cyan-300 font-medium hover:text-cyan-200 transition-colors"
          >
            View all vaults <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex justify-center">
          {showcaseVaults.map((vault, i) => (
            <div
              key={i}
              className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-md transition-all hover:bg-white/[0.06] hover:-translate-y-1 w-full max-w-md cursor-pointer"
            >
              <div className="flex items-start justify-between mb-8">
                <Badge
                  variant="outline"
                  className="bg-white/5 border-white/10 text-slate-300 uppercase tracking-widest text-[10px]"
                >
                  {vault.category}
                </Badge>
                <span
                  className={`text-sm font-medium ${
                    vault.performance.startsWith("+") ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {vault.performance} APY
                </span>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">{vault.name}</h3>
              <div className="flex items-center justify-between mt-6">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                    {vault.manager.charAt(0)}
                  </div>
                  <span className="text-xs text-slate-400">{vault.manager}</span>
                </div>
                <span className="text-xs text-slate-500">{vault.risk} Risk</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
