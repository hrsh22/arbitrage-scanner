import { Cpu, UserCog, UserCheck } from "lucide-react";

export function AgentCuratorSection() {
  const models = [
    {
      icon: Cpu,
      title: "Agent Vaults",
      desc: "Autonomous strategies executed by agents within defined mandates.",
      color: "text-cyan-400",
      bg: "bg-cyan-400/10",
      border: "border-cyan-400/20",
    },
    {
      icon: UserCog,
      title: "Curator Vaults",
      desc: "Human-managed vaults with clear strategy framing and risk profiles.",
      color: "text-fuchsia-400",
      bg: "bg-fuchsia-400/10",
      border: "border-fuchsia-400/20",
    },
    {
      icon: UserCheck,
      title: "Hybrid Vaults",
      desc: "Agent-driven execution with human oversight, controls, or approval.",
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/20",
    },
  ];

  return (
    <section className="relative border-t border-white/5 bg-slate-950/50 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 md:w-3/4 sm:mb-16">
          <h2 className="text-3xl font-semibold tracking-tight text-white mb-6 sm:text-4xl text-left">
            Built for allocating capital <br className="hidden sm:block" />
            <span className="text-slate-400">to prediction markets</span>
          </h2>
          <p className="text-base leading-relaxed text-slate-300 sm:text-lg">
            PM Vaults are built to make prediction market capital allocatable. Users delegate capital to experts, generating passive exposure to Predication Markets. Each vault surfaces the manager, strategy type, and risk profile up front, while the execution stays contained inside the vault.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {models.map((model) => {
            const Icon = model.icon;
            return (
              <div
                key={model.title}
                className="group rounded-[24px] border border-white/10 bg-white/[0.04] p-5 shadow-xl backdrop-blur-md transition-all hover:bg-white/[0.06] sm:rounded-[28px] sm:p-8"
              >
                <div
                  className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border ${model.bg} ${model.color} ${model.border}`}
                >
                  <Icon className="h-7 w-7" />
                </div>
                <h3 className="mb-3 text-xl font-medium text-white">{model.title}</h3>
                <p className="text-slate-400 leading-relaxed">{model.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
