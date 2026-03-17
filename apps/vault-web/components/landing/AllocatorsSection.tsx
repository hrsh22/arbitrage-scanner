import { PieChart, Bot } from "lucide-react";

export function AllocatorsSection() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 bg-slate-950/50 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Built for allocators
          </h2>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Indices Card */}
          <div className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-md transition-all hover:bg-white/[0.06]">
            <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-fuchsia-400/10 blur-[40px] transition-all group-hover:bg-fuchsia-400/20" />
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-400/20 text-fuchsia-300">
              <PieChart className="h-7 w-7" />
            </div>
            <h3 className="mb-3 text-2xl font-medium text-white">
              Own market themes, <br />
              <span className="text-slate-400">not just single outcomes</span>
            </h3>
            <p className="text-slate-300 leading-relaxed">
              Get diversified exposure through vaults built around crypto, politics, macro, sports,
              or custom event baskets.
            </p>
          </div>

          {/* Strategy Vaults Card */}
          <div className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-md transition-all hover:bg-white/[0.06]">
            <div className="absolute -right-12 -bottom-12 h-48 w-48 rounded-full bg-cyan-400/10 blur-[40px] transition-all group-hover:bg-cyan-400/20" />
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/20 text-cyan-300">
              <Bot className="h-7 w-7" />
            </div>
            <h3 className="mb-3 text-2xl font-medium text-white">
              Back agents <br />
              <span className="text-slate-400">and curators</span>
            </h3>
            <p className="text-slate-300 leading-relaxed">
              Allocate to vaults run by autonomous agents or human managers with defined mandates,
              risk tiers, and execution rules.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
