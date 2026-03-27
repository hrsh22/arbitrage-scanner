import { Skeleton } from "@workspace/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-10 w-40 bg-white/10" />
        <Skeleton className="h-[220px] w-full rounded-[2px] bg-[#212121]" />
        <Skeleton className="h-[540px] w-full rounded-[2px] bg-[#212121]" />
      </div>
    </main>
  );
}
