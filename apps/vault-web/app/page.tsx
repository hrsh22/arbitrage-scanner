import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Polymarket Vault",
  description: "Allocate capital into prediction market strategy vaults.",
};

const APP_URL = "/discover";
const BUILD_URL = "https://github.com";

const stats = [
  ["Vault Shares", "Capital Model", "Own strategy exposure"],
  ["Single NAV", "Portfolio View", "Track pooled performance"],
  ["Mandates", "Risk Framing", "Strategy rules up front"],
  ["Agents / Curators", "Managers", "Autonomous or human-led"],
] as const;

const introCards = [
  {
    eyebrow: "Themes",
    title: "Own market themes",
    body: "Get diversified exposure through vaults built around crypto, politics, macro, sports, or custom event baskets.",
    icon: <ThemeIcon />,
  },
  {
    eyebrow: "Managers",
    title: "Back agents and curators",
    body: "Allocate to vaults run by autonomous agents or human managers with defined mandates, risk tiers, and execution rules.",
    icon: <BotIcon />,
  },
  {
    eyebrow: "Reporting",
    title: "Track NAV and activity",
    body: "Follow strategy performance, fees, settlement activity, and share value from one place instead of scattered positions.",
    icon: <ChartIcon />,
  },
] as const;

const flowPills = [
  { label: "Deposit", tone: "gold" },
  { label: "Vault Shares", tone: "gold" },
  { label: "Mandate", tone: "green" },
  { label: "Execution", tone: "green" },
  { label: "NAV", tone: "gold" },
] as const;

const steps = [
  {
    title: "Deposit into a vault",
    body: "Choose an index or strategy vault and deposit funds.",
    icon: <WalletIcon />,
  },
  {
    title: "Receive vault shares",
    body: "Your capital is pooled into an investable product with a defined mandate.",
    icon: <SharesIcon />,
  },
  {
    title: "Mandate handles execution",
    body: "Agent, curator, or hybrid strategies manage positions inside the vault instead of asking you to pick markets one by one.",
    icon: <TerminalChartIcon />,
  },
  {
    title: "Track a single NAV",
    body: "Capital is deployed, and returns flow back into vault NAV while activity and reporting stay visible.",
    icon: <PulseIcon />,
  },
  {
    title: "Lock in returns",
    body: "Use vault shares, NAV, and settlement reporting to compare, hold, and exit strategy exposure cleanly.",
    icon: <WithdrawIcon />,
  },
] as const;

const models = [
  {
    eyebrow: "Agent Vaults",
    title: "Autonomous strategies",
    body: "Autonomous strategies executed by agents within defined mandates.",
    icon: <CpuIcon />,
  },
  {
    eyebrow: "Curator Vaults",
    title: "Human-managed vaults",
    body: "Human-managed vaults with clear strategy framing and risk profiles.",
    icon: <UserCogIcon />,
  },
  {
    eyebrow: "Hybrid Vaults",
    title: "Oversight and controls",
    body: "Agent-driven execution with human oversight, controls, or approval.",
    icon: <UserCheckIcon />,
  },
] as const;

const strategies = [
  {
    href: "/vault/sisyphus-vault",
    direction: "Vault",
    directionClass: "border-[#E8C08C]/40 bg-[#E8C08C]/10 text-[#E8C08C]",
    title: "Sisyphus Vault",
    body: "Agent-managed vault focused on BTC 15m market.",
    chart: "M0,50 Q50,45 100,38 T200,28 T300,18 T400,8",
    chartColor: "#58A65C",
    gradientId: "sisyphus-vault",
    manager: "Sisyphus Agent",
    risk: "High Risk",
  },
] as const;

export default function LandingPage() {
  return (
    <main className="relative w-full overflow-hidden bg-[#0A0908] font-[family-name:var(--font-landing-sans)] text-[#F1EEE8]">
      <section className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0 bg-[#0A0908]" />
        <div className="grid-bg absolute inset-0 z-0 opacity-30" />
        <div className="ambient-glow">
          <div className="aurora-bg" />
          <div className="glow-sweep" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-4 animate-in fade-in duration-700">
          <div className="mb-12 flex flex-col items-center animate-in fade-in zoom-in-90 slide-in-from-top-4 duration-700">
            <div className="flex items-center gap-4">
              <LogoMark className="h-10 w-10" />
              <h1 className="text-2xl font-bold tracking-wider text-[#F1EEE8] md:text-3xl">
                Polymarket Vault
              </h1>
            </div>
          </div>

          <div className="mb-8 text-center">
            <h2 className="font-serif text-4xl font-bold leading-tight text-[#F1EEE8] animate-in fade-in slide-in-from-bottom-8 duration-700 md:text-6xl lg:text-7xl">
              Vaults For
            </h2>
            <h2 className="pb-2 font-serif text-4xl font-bold leading-tight text-[#E8C08C] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 md:pb-4 md:text-6xl lg:text-7xl">
              Prediction Market Strategies
            </h2>
          </div>

          <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300 sm:flex-row">
            <GoldOutlineButton href={APP_URL}>Explore Vaults</GoldOutlineButton>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 animate-in fade-in duration-700 delay-500">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-[#9B9690]/50">Scroll</span>
            <ArrowDownIcon />
          </div>
        </div>
      </section>

      <section className="relative z-10 border-y border-[#E8C08C]/10 bg-[#0D0C0A]">
        <div className="mx-auto max-w-6xl px-6 py-10 md:py-14">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-12">
            {stats.map(([value, label, detail]) => (
              <div className="text-center md:text-left" key={value}>
                <p className="mb-1 text-2xl font-bold text-[#E8C08C] md:text-3xl">{value}</p>
                <p className="mb-0.5 text-sm font-bold text-[#F1EEE8]/80">{label}</p>
                <p className="text-xs text-[#9B9690]">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 md:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <SectionIntro
            eyebrow="Why PM Vaults"
            title={
              <>
                Prediction markets are powerful.
                <br />
                Using them well is still too hard.
              </>
            }
          >
            Today, prediction markets are trader-centric. Users manage individual outcomes,
            fragmented positions, and manual risk. PM Vaults turn that into a cleaner product:
            deposit into a vault, receive shares, and get exposure to a strategy instead of a stream
            of trades.
          </SectionIntro>

          <div className="grid gap-6 md:grid-cols-3">
            {introCards.map((card) => (
              <div
                className="group relative rounded-2xl border border-[#E8C08C]/10 bg-[#13120F] p-6 transition-all duration-300 hover:border-[#E8C08C]/25 md:p-8"
                key={card.title}
              >
                <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.2em] text-[#E8C08C]/50">
                  {card.eyebrow}
                </span>
                <IconShell>{card.icon}</IconShell>
                <h4 className="mb-2 text-lg font-bold text-[#F1EEE8]">{card.title}</h4>
                <p className="text-sm leading-relaxed text-[#9B9690]">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#0D0C0A] py-24 md:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <SectionIntro eyebrow="Product shift" title="From outcomes to portfolios" />

          <div className="grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <ComparisonCard
              tone="muted"
              title="Before: Trader-Centric"
              items={[
                "Pick markets one by one",
                "Manage positions manually",
                "Track scattered PnL",
                "React to settlement yourself",
              ]}
            />
            <div className="flex justify-center rotate-90 md:rotate-0">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#E8C08C]/20 bg-[#E8C08C]/5 text-[#E8C08C]">
                <RightArrowIcon />
              </div>
            </div>
            <ComparisonCard
              tone="gold"
              title="After: PM Vaults"
              items={[
                "Deposit into a vault",
                "Own strategy shares",
                "Track a single NAV",
                "Let mandates handle execution",
              ]}
            />
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 md:py-32">
        <div className="mx-auto max-w-4xl px-6">
          <SectionIntro
            eyebrow="How Vaults Work"
            title={
              <>
                How vaults turn markets
                <br />
                into investable products
              </>
            }
            description="From deposit to NAV reporting — a cleaner way to access prediction-market strategies."
          />

          <div className="mb-16 flex flex-wrap items-center justify-center gap-2 md:gap-3">
            {flowPills.map((pill, index) => (
              <div className="contents" key={pill.label}>
                <span
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold md:px-4 md:py-2 md:text-sm ${
                    pill.tone === "green"
                      ? "border-[#58A65C]/30 bg-[#58A65C]/[0.03] text-[#58A65C]"
                      : "border-[#E8C08C]/30 bg-[#E8C08C]/[0.03] text-[#E8C08C]"
                  }`}
                >
                  {pill.label}
                </span>
                {index < flowPills.length - 1 && <FlowArrow />}
              </div>
            ))}
          </div>

          <div className="relative">
            <div className="absolute bottom-[40px] left-[23px] top-[40px] hidden w-px bg-gradient-to-b from-[#E8C08C]/20 via-[#E8C08C]/10 to-[#E8C08C]/20 md:left-[27px] md:block" />
            <div className="flex flex-col gap-4 md:gap-5">
              {steps.map((step, index) => (
                <div className="group flex items-start gap-4 md:gap-6" key={step.title}>
                  <div className="relative z-10 flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full border border-[#E8C08C]/20 bg-[#13120F] transition-all duration-300 group-hover:border-[#E8C08C]/50 group-hover:shadow-[0_0_16px_rgba(232,192,140,0.08)] md:h-[56px] md:w-[56px]">
                    <span className="font-mono text-sm font-bold text-[#E8C08C]/60 transition-colors duration-300 group-hover:text-[#E8C08C] md:text-base">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex flex-1 items-start gap-4 rounded-xl border border-[#E8C08C]/[0.08] bg-[#13120F] p-5 transition-all duration-300 group-hover:border-[#E8C08C]/20 group-hover:bg-[#15140F] md:p-6">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#E8C08C]/10 bg-[#E8C08C]/5">
                      {step.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="mb-1 text-base font-bold text-[#F1EEE8] md:text-lg">
                        {step.title}
                      </h4>
                      <p className="text-sm leading-relaxed text-[#9B9690]">{step.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#0D0C0A] py-24 md:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-16 max-w-3xl">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#E8C08C]/20 bg-[#E8C08C]/5 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#E8C08C]">
              Agent and curator capital
            </span>
            <h3 className="mb-6 font-serif text-3xl font-bold leading-tight text-[#F1EEE8] md:text-5xl">
              Built for allocating capital
              <br />
              to prediction markets
            </h3>
            <p className="text-base leading-relaxed text-[#9B9690] md:text-lg">
              PM Vaults are built to make prediction market capital allocatable. Users delegate
              capital to experts, generating passive exposure to Prediction Markets. Each vault
              surfaces the manager, strategy type, and risk profile up front, while the execution
              stays contained inside the vault.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {models.map((model) => (
              <div
                className="group relative rounded-2xl border border-[#E8C08C]/10 bg-[#13120F] p-6 transition-all duration-300 hover:border-[#E8C08C]/25 md:p-8"
                key={model.title}
              >
                <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.2em] text-[#E8C08C]/50">
                  {model.eyebrow}
                </span>
                <IconShell>{model.icon}</IconShell>
                <h4 className="mb-2 text-lg font-bold text-[#F1EEE8]">{model.title}</h4>
                <p className="text-sm leading-relaxed text-[#9B9690]">{model.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#0D0C0A] py-24 md:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <SectionIntro eyebrow="Featured vault" title="Discover Vaults" />

          <div className="mx-auto grid max-w-md gap-6">
            {strategies.map((strategy) => (
              <Link
                className="group relative block rounded-2xl border border-[#E8C08C]/10 bg-[#13120F] p-6 transition-all duration-300 hover:border-[#E8C08C]/25 md:p-8"
                href={strategy.href}
                key={strategy.title}
              >
                <div className="mb-4 flex items-center gap-3">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold ${strategy.directionClass}`}
                  >
                    {strategy.direction}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#58A65C]" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#58A65C]">
                      Live
                    </span>
                  </span>
                </div>
                <h4 className="mb-3 text-xl font-bold text-[#F1EEE8] md:text-2xl">
                  {strategy.title}
                </h4>
                <p className="mb-6 text-sm leading-relaxed text-[#9B9690]">{strategy.body}</p>
                <div className="relative mb-6 h-16 w-full overflow-hidden rounded-lg border border-[#E8C08C]/5 bg-[#0A0908]">
                  <svg
                    className="absolute inset-0"
                    height="64"
                    preserveAspectRatio="none"
                    viewBox="0 0 400 64"
                    width="100%"
                  >
                    <defs>
                      <linearGradient id={strategy.gradientId} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={strategy.chartColor} stopOpacity="0.15" />
                        <stop offset="100%" stopColor={strategy.chartColor} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d={strategy.chart}
                      fill="none"
                      opacity="0.6"
                      stroke={strategy.chartColor}
                      strokeWidth="2"
                    />
                    <path
                      d={`${strategy.chart} L400,64 L0,64Z`}
                      fill={`url(#${strategy.gradientId})`}
                    />
                  </svg>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs text-[#9B9690]">
                    {strategy.manager} · {strategy.risk}
                  </div>
                  <span className="text-sm font-bold text-[#E8C08C] transition-transform duration-300 group-hover:translate-x-1">
                    Explore →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 bg-[#0D0C0A] py-24 md:py-32">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h3 className="mb-6 font-serif text-3xl font-bold leading-tight text-[#F1EEE8] md:text-5xl">
            From trader-centric markets
            <br />
            to investable products
          </h3>
          <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed text-[#9B9690] md:text-lg">
            Prediction markets shouldn&apos;t stop at trading. They should support indices,
            mandates, vaults, and agent-managed capital. PM Vaults turn markets into products users
            can allocate to, compare, and hold.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <GoldSolidButton href={APP_URL}>Explore Vaults</GoldSolidButton>
            <GoldOutlineButton href={BUILD_URL}>Start Building</GoldOutlineButton>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[#E8C08C]/10 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-3">
              <LogoMark className="h-6 w-6" />
              <span className="text-sm font-bold text-[#F1EEE8]/60">Polymarket Vault</span>
            </div>
            <p className="text-xs text-[#9B9690]/60">
              Prediction-market strategy vaults · Shares, NAV, mandates, and reporting
            </p>
            <div className="flex items-center gap-6">
              <Link
                className="text-xs text-[#9B9690] transition-colors duration-200 hover:text-[#E8C08C]"
                href={APP_URL}
              >
                Explore Vaults
              </Link>
              <a
                className="text-xs text-[#9B9690] transition-colors duration-200 hover:text-[#E8C08C]"
                href={BUILD_URL}
                rel="noreferrer"
                target="_blank"
              >
                Start Building
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ComparisonCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: "gold" | "muted";
}) {
  const isGold = tone === "gold";

  return (
    <div
      className={`relative rounded-2xl border p-6 md:p-8 ${
        isGold
          ? "border-[#E8C08C]/20 bg-[#E8C08C]/5 shadow-[0_0_40px_rgba(232,192,140,0.08)]"
          : "border-[#E8C08C]/10 bg-[#13120F]"
      }`}
    >
      <h4 className="mb-6 text-xl font-bold text-[#F1EEE8]">{title}</h4>
      <ul className="space-y-4">
        {items.map((item) => (
          <li className="flex items-center gap-3 text-sm text-[#9B9690]" key={item}>
            {isGold ? <CheckIcon /> : <XIcon />}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-16 text-center">
      <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#E8C08C]/20 bg-[#E8C08C]/5 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#E8C08C]">
        {eyebrow}
      </span>
      <h3 className="mb-6 font-serif text-3xl font-bold leading-tight text-[#F1EEE8] md:text-5xl">
        {title}
      </h3>
      {(description || children) && (
        <p className="mx-auto max-w-3xl text-base leading-relaxed text-[#9B9690] md:text-lg">
          {description ?? children}
        </p>
      )}
    </div>
  );
}

function GoldOutlineButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      className="group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-[#E8C08C]/30 bg-[#0A0908] px-8 py-4 transition-colors duration-300 hover:border-[#E8C08C] hover:shadow-[0_0_20px_rgba(232,192,140,0.2)]"
      href={href}
    >
      <div className="pointer-events-none absolute inset-0 rounded-full bg-[#E8C08C] opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-30" />
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#E8C08C]/10 to-transparent transition-transform duration-1000 ease-in-out group-hover:translate-x-full" />
      <span className="relative text-base font-bold tracking-wide text-[#E8C08C]">{children}</span>
    </Link>
  );
}

function GoldSolidButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      className="group relative inline-flex items-center justify-center overflow-hidden rounded-full bg-[#E8C08C] px-10 py-5 transition-all duration-300 hover:shadow-[0_0_30px_rgba(232,192,140,0.3)]"
      href={href}
    >
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 ease-in-out group-hover:translate-x-full" />
      <span className="relative text-base font-bold tracking-wide text-[#0A0908]">{children}</span>
    </Link>
  );
}

function IconShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[#E8C08C]/10 bg-[#E8C08C]/5 transition-colors duration-300 group-hover:bg-[#E8C08C]/10">
      {children}
    </div>
  );
}

function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <rect height="43" rx="2" stroke="#F1EEE8" strokeOpacity="0.7" width="43" x="0.5" y="0.5" />
      <rect fill="#F1EEE8" fillOpacity="0.1" height="36" rx="1" width="36" x="4" y="4" />
      <rect fill="#F1EEE8" height="6" rx="1" width="6" x="14" y="13" />
      <rect fill="#F1EEE8" height="6" rx="1" width="6" x="24" y="13" />
      <rect
        height="12"
        rx="1"
        stroke="#F1EEE8"
        strokeOpacity="0.8"
        strokeWidth="1.2"
        width="16"
        x="14"
        y="23"
      />
    </svg>
  );
}

function FlowArrow() {
  return (
    <svg
      className="hidden shrink-0 sm:block"
      fill="none"
      height="12"
      viewBox="0 0 20 12"
      width="20"
    >
      <path
        d="M2 6h16M14 2l4 4-4 4"
        opacity="0.3"
        stroke="#E8C08C"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 16 24" width="16">
      <path
        d="M8 4v16M8 20l-4-4M8 20l4-4"
        opacity="0.4"
        stroke="#9B9690"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <circle cx="11" cy="11" r="7" stroke="#E8C08C" strokeWidth="1.5" />
      <path d="M21 21l-4.35-4.35" stroke="#E8C08C" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <rect height="12" rx="3" stroke="#E8C08C" strokeWidth="1.5" width="16" x="4" y="7" />
      <path
        d="M9 7V4h6v3M9 12h.01M15 12h.01M8 16h8"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M3 17l4-4 4 4 4-8 5 6"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M3 3v18h18" stroke="#E8C08C" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg fill="none" height="28" viewBox="0 0 28 28" width="28">
      <rect height="16" rx="3" stroke="#E8C08C" strokeWidth="1.5" width="20" x="4" y="6" />
      <path d="M4 11h20" stroke="#E8C08C" strokeWidth="1.5" />
      <circle cx="19" cy="17" fill="#E8C08C" r="1.5" />
    </svg>
  );
}

function SharesIcon() {
  return (
    <svg fill="none" height="28" viewBox="0 0 28 28" width="28">
      <rect height="8" rx="2" stroke="#E8C08C" strokeWidth="1.5" width="8" x="5" y="5" />
      <rect height="8" rx="2" stroke="#E8C08C" strokeWidth="1.5" width="8" x="15" y="5" />
      <rect height="8" rx="2" stroke="#58A65C" strokeWidth="1.5" width="8" x="10" y="15" />
    </svg>
  );
}

function CpuIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <rect height="12" rx="2" stroke="#E8C08C" strokeWidth="1.5" width="12" x="6" y="6" />
      <path
        d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function UserCogIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <circle cx="10" cy="8" r="4" stroke="#E8C08C" strokeWidth="1.5" />
      <path d="M3 21a7 7 0 0 1 10-6.32" stroke="#E8C08C" strokeLinecap="round" strokeWidth="1.5" />
      <path
        d="M18 14v2M18 22v-2M14.54 16l1.73 1M21.46 20l-1.73-1M14.54 20l1.73-1M21.46 16l-1.73 1"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function UserCheckIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <circle cx="9" cy="8" r="4" stroke="#E8C08C" strokeWidth="1.5" />
      <path
        d="M3 21a7 7 0 0 1 11.5-5.35"
        stroke="#E8C08C"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M15 19l2 2 4-5"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function RightArrowIcon() {
  return (
    <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5 shrink-0 text-[#58A65C]" fill="none" viewBox="0 0 24 24">
      <path
        d="M5 12l4 4L19 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-5 w-5 shrink-0 text-[#DC2626]/70" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TerminalChartIcon() {
  return (
    <svg fill="none" height="28" viewBox="0 0 28 28" width="28">
      <rect height="14" rx="2" stroke="#E8C08C" strokeWidth="1.5" width="22" x="3" y="8" />
      <path
        d="M7 18l4-5 3 3 7-7"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="21" cy="9" fill="#58A65C" r="1" />
      <path d="M9 4h5M11.5 2v4" stroke="#E8C08C" strokeLinecap="round" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg fill="none" height="28" viewBox="0 0 28 28" width="28">
      <path
        d="M6 14h4l2-5 3 10 2-7 2 4h3"
        stroke="#E8C08C"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle cx="14" cy="14" r="10" stroke="#E8C08C" strokeDasharray="3 2" strokeWidth="1.5" />
    </svg>
  );
}

function WithdrawIcon() {
  return (
    <svg fill="none" height="28" viewBox="0 0 28 28" width="28">
      <path
        d="M14 4v12m0 0l-4-4m4 4l4-4"
        stroke="#58A65C"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M6 20v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="#E8C08C"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
