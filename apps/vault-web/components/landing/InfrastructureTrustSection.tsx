import { ShieldCheck, LineChart, FileText } from "lucide-react";

export function InfrastructureTrustSection() {
  const blocks = [
    {
      icon: FileText,
      title: "Mandates",
      desc: "Each vault defines what it can do upfront.",
    },
    {
      icon: LineChart,
      title: "NAV & shares",
      desc: "Users invest in a strategy, not individual positions.",
    },
    {
      icon: ShieldCheck,
      title: "Reporting",
      desc: "Track performance, fees, and activity from one place.",
    },
  ];

  return (
    <section className="relative px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-5xl text-center">
        <h2 className="mb-6 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Transparent by structure
        </h2>
        <p className="mx-auto mb-16 max-w-2xl text-lg text-slate-300 leading-relaxed">
          Vaults package prediction market strategies into products users can understand: shares, NAV,
          mandates, and reporting.
        </p>

        <div className="grid gap-6 md:grid-cols-3 text-left">
          {blocks.map((block, idx) => {
            const Icon = block.icon;
            return (
              <div
                key={idx}
                className="rounded-[28px] border border-white/5 bg-white/[0.02] p-8 backdrop-blur-sm"
              >
                <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-slate-300">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-3 text-xl font-medium text-white">{block.title}</h3>
                <p className="text-slate-400">{block.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
