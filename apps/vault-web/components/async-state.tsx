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
        isError && "flex-row justify-start gap-3 text-left",
        isDashed && "rounded-2xl border border-dashed border-[#CCCAC4] bg-[#F0EDE8] py-12 px-6",
        isCard && "rounded-2xl border border-[#CCCAC4] bg-[#F1EEE8] py-10 px-6",
        isError && "rounded-2xl border border-rose-400/25 bg-rose-50 py-4 px-6 text-rose-700",
        isTransparent && "py-12 px-6",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className={cn("mb-3", isError ? "mb-0 shrink-0 text-rose-500" : "text-[#615E4E]")}>
          {icon}
        </div>
      )}
      {title && (
        <div
          className={cn(
            "font-medium",
            isError ? "text-rose-700" : "text-[#1A202C]",
            isCard ? "text-sm" : "text-sm",
          )}
        >
          {title}
        </div>
      )}
      {description && (
        <div
          className={cn(
            "mt-1 max-w-xs text-xs leading-6",
            isError ? "text-rose-600" : "text-[#615E4E]",
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
