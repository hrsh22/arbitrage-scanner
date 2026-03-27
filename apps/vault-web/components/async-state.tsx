import * as React from "react";
import { AlertCircle, Lock } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

export interface AsyncStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "card" | "dashed" | "error" | "transparent";
}

export function AsyncState({
  icon,
  title,
  description,
  variant = "dashed",
  className,
  children,
  ...props
}: AsyncStateProps) {
  const isDashed = variant === "dashed";
  const isCard = variant === "card";
  const isError = variant === "error";
  const isTransparent = variant === "transparent";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        isDashed && "rounded-2xl border border-dashed border-white/15 bg-white/[0.03] py-12 px-6",
        isCard && "rounded-[2px] border border-[#212121] bg-[#121212] py-10 px-6",
        isError && "rounded-[2px] border border-rose-400/25 bg-rose-400/10 py-4 px-6 text-rose-100",
        isTransparent && "py-12 px-6",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className={cn("mb-3", isError ? "text-rose-400" : "text-slate-500")}>{icon}</div>
      )}
      {title && (
        <div
          className={cn(
            "font-medium",
            isError ? "text-rose-100" : "text-white",
            isCard ? "text-sm text-[#828B8D]" : "text-sm",
          )}
        >
          {title}
        </div>
      )}
      {description && (
        <div
          className={cn(
            "mt-1 max-w-xs text-xs leading-6",
            isError ? "text-rose-200/70" : "text-slate-400",
          )}
        >
          {description}
        </div>
      )}
      {children && <div className="mt-4 w-full">{children}</div>}
    </div>
  );
}

export function EmptyState(
  props: Omit<AsyncStateProps, "variant"> & { variant?: AsyncStateProps["variant"] },
) {
  return <AsyncState {...props} />;
}

export function ErrorState(
  props: Omit<AsyncStateProps, "variant"> & { variant?: AsyncStateProps["variant"] },
) {
  return (
    <AsyncState
      variant={props.variant ?? "error"}
      icon={props.icon ?? <AlertCircle className="h-5 w-5" />}
      {...props}
    />
  );
}

export function AuthGatedState(
  props: Omit<AsyncStateProps, "variant"> & { variant?: AsyncStateProps["variant"] },
) {
  return (
    <AsyncState
      icon={<Lock className="h-6 w-6" />}
      title="Wallet disconnected"
      description="Connect your wallet to view and manage this area."
      {...props}
    />
  );
}

export function LoadingState({ children, className }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-in fade-in-0 duration-500", className)}>{children}</div>;
}
