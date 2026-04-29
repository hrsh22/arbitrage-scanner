import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { ArrowRight, Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative flex min-h-[80dvh] w-full items-center justify-center overflow-hidden px-4 py-16 sm:min-h-[85vh] sm:px-6 sm:pt-16">
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <div className="absolute top-[42%] left-[38%] h-[260px] w-[360px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle_at_center,_rgba(217,70,239,0.10)_0%,_transparent_66%)] blur-[64px]" />
        <div className="absolute top-[48%] left-[64%] h-[240px] w-[340px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle_at_center,_rgba(34,211,238,0.09)_0%,_transparent_68%)] blur-[60px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <div className="mb-8 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-1.5 text-sm font-medium text-cyan-200 backdrop-blur-md">
            <Sparkles className="h-4 w-4" />
            <span>The execution layer for prediction markets</span>
          </div>
        </div>

        <h1 className="animate-in fade-in slide-in-from-bottom-6 duration-1000 text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-7xl lg:text-8xl">
          Vaults For <br className="hidden sm:block" />
          <span className="bg-[linear-gradient(90deg,_#38bdf8_0%,_#818cf8_32%,_#a855f7_62%,_#f472b6_100%)] bg-clip-text text-transparent drop-shadow-[0_0_32px_rgba(168,85,247,0.22)]">
            Prediction Market Strategies.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150 text-base leading-7 text-slate-300 sm:mt-8 sm:text-xl sm:leading-8">
          Allocate capital into vaults managed by agents or humans, running strategies on prediction
          markets
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:mt-12 sm:flex-row animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-300">
          <Link href="/discover">
            <Button
              size="lg"
              className="group h-14 min-w-[200px] rounded-full bg-cyan-300 text-lg font-semibold text-cyan-950 shadow-[0_0_40px_rgba(34,211,238,0.3)] transition-all hover:bg-cyan-200 hover:shadow-[0_0_60px_rgba(34,211,238,0.4)]"
            >
              Explore Vaults
              <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
