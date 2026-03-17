import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";

export function TransformationSection() {
  return (
    <section className="relative px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            From outcomes to portfolios
          </h2>
        </div>

        <div className="grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-center">
          {/* Before */}
          <div className="rounded-[28px] border border-white/5 bg-white/[0.02] p-8 backdrop-blur-sm">
            <h3 className="mb-6 text-xl font-medium text-slate-400">Before: Trader-Centric</h3>
            <ul className="space-y-4">
              {[
                "Pick markets one by one",
                "Manage positions manually",
                "Track scattered PnL",
                "React to settlement yourself",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-slate-300">
                  <XCircle className="h-5 w-5 text-rose-400/50" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Arrow */}
          <div className="flex justify-center md:rotate-0 rotate-90">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400/10 text-cyan-300">
              <ArrowRight className="h-6 w-6" />
            </div>
          </div>

          {/* After */}
          <div className="relative rounded-[28px] border border-cyan-400/20 bg-cyan-400/5 p-8 shadow-[0_0_40px_rgba(34,211,238,0.1)] backdrop-blur-md">
            <div className="absolute inset-0 rounded-[28px] bg-gradient-to-br from-cyan-400/10 to-transparent pointer-events-none" />
            <h3 className="mb-6 text-xl font-medium text-white relative z-10">After: PM Vaults</h3>
            <ul className="space-y-4 relative z-10">
              {[
                "Deposit into a vault",
                "Own strategy shares",
                "Track a single NAV",
                "Let mandates handle execution",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-cyan-100">
                  <CheckCircle2 className="h-5 w-5 text-cyan-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
