import Link from "next/link";
import { Button } from "@workspace/ui/components/button";

export function VisionSection() {
  return (
    <section className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-4xl text-center rounded-[40px] border border-cyan-400/20 bg-cyan-400/5 p-12 md:p-20 shadow-[0_0_80px_rgba(34,211,238,0.1)] backdrop-blur-md relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(34,211,238,0.1)_0%,_transparent_100%)] pointer-events-none" />

        <h2 className="relative z-10 text-3xl font-semibold tracking-tight text-white mb-6 sm:text-5xl">
          From trader-centric markets <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400">
            to investable products
          </span>
        </h2>
        <p className="relative z-10 mx-auto mb-12 max-w-2xl text-lg text-slate-300 leading-relaxed">
          Prediction markets shouldn&apos;t stop at trading. They should support indices, mandates, vaults,
          and agent-managed capital. PM Vaults turn markets into products users can allocate to, compare,
          and hold.
        </p>

        <div className="relative z-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href="/discover">
            <Button
              size="lg"
              className="h-14 min-w-[200px] rounded-full bg-cyan-300 text-lg font-semibold text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.3)] transition-all hover:bg-cyan-200"
            >
              Explore Vaults
            </Button>
          </Link>
          <Link href="https://github.com" target="_blank" rel="noopener noreferrer">
            <Button
              size="lg"
              variant="outline"
              className="h-14 min-w-[200px] rounded-full border-white/10 bg-white/5 text-lg font-medium text-white backdrop-blur-md transition-all hover:bg-white/10 hover:text-cyan-200"
            >
              Start Building
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
