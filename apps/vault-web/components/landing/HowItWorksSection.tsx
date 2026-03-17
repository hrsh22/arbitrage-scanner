export function HowItWorksSection() {
  const steps = [
    {
      num: "01",
      title: "Deposit into a vault",
      desc: "Choose an index or strategy vault and deposit funds.",
    },
    {
      num: "02",
      title: "Receive vault shares",
      desc: "Your capital is pooled into an investable product with a defined mandate.",
    },
    {
      num: "03",
      title: "Track NAV as the strategy executes",
      desc: "Agents or curators deploy capital, positions settle, and performance flows back into vault NAV.",
    },
  ];

  return (
    <section className="relative px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl text-center">
            How vaults work
          </h2>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className="relative rounded-[28px] border border-white/5 bg-white/[0.02] p-8 backdrop-blur-sm"
            >
              <div className="mb-6 text-5xl font-bold tracking-tighter text-white/10">
                {step.num}
              </div>
              <h3 className="mb-4 text-xl font-medium text-white">{step.title}</h3>
              <p className="text-slate-400 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
