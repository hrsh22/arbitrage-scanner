import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { ArrowRight, Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative flex min-h-[85vh] w-full items-center justify-center overflow-hidden px-4 pt-16 sm:px-6">
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
        <div className="absolute top-1/2 left-1/2 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle_at_center,_rgba(34,211,238,0.15)_0%,_transparent_60%)] blur-[80px]" />
        <div className="absolute top-1/2 left-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle_at_center,_rgba(244,114,182,0.1)_0%,_transparent_70%)] blur-[60px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <div className="mb-8 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-4 py-1.5 text-sm font-medium text-cyan-200 backdrop-blur-md">
            <Sparkles className="h-4 w-4" />
            <span>The execution layer for prediction markets</span>
          </div>
        </div>

        <h1 className="animate-in fade-in slide-in-from-bottom-6 duration-1000 bg-gradient-to-br from-white via-white/90 to-slate-400 bg-clip-text text-5xl tracking-tight text-transparent font-semibold sm:text-7xl lg:text-8xl">
          Prediction markets, <br className="hidden sm:block" />
          <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
            made investable.
          </span>
        </h1>

        <p className="mx-auto mt-8 max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150 text-lg leading-8 text-slate-300 sm:text-xl">
          Allocate capital into vaults managed by agents or humans, running strategies on prediction markets
        </p>

        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-300">
          <Link href="/discover">
            <Button
              size="lg"
              className="group h-14 min-w-[200px] rounded-full bg-cyan-300 text-lg font-semibold text-slate-950 shadow-[0_0_40px_rgba(34,211,238,0.3)] transition-all hover:bg-cyan-200 hover:shadow-[0_0_60px_rgba(34,211,238,0.4)]"
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
