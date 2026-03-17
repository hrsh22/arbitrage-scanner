export function ThesisSection() {
  return (
    <section className="relative px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-5xl lg:leading-[1.1]">
          Prediction markets are powerful. <br className="hidden sm:block" />
          <span className="text-slate-400">Using them well is still too hard.</span>
        </h2>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-slate-300">
          Today, prediction markets are trader-centric. Users manage individual outcomes, fragmented
          positions, and manual risk. PM Vaults turn that into a cleaner product: deposit into a
          vault, receive shares, and get exposure to a strategy instead of a stream of trades.
        </p>
      </div>
    </section>
  );
}
