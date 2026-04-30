import { Skeleton } from "@workspace/ui/components/skeleton";

export default function Loading() {
  return (
    <main className="polyvaults-app-shell flex-1 px-4 py-10 sm:px-6 lg:px-20 lg:py-12">
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-10 w-40 rounded-full bg-[#E8D9C0]" />
        <Skeleton className="h-[220px] w-full rounded-2xl bg-[#E8D9C0]" />
        <Skeleton className="h-[540px] w-full rounded-2xl bg-[#E8D9C0]" />
      </div>
    </main>
  );
}
