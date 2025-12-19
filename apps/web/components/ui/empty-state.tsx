import { LucideIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

interface EmptyStateProps {
    icon: LucideIcon
    title: string
    description: string
    action?: {
        label: string
        onClick: () => void
    }
    variant?: "default" | "profit" | "polymarket" | "kalshi"
    className?: string
}

const variantStyles = {
    default: "text-muted-foreground",
    profit: "text-profit",
    polymarket: "text-polymarket",
    kalshi: "text-kalshi",
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    variant = "default",
    className,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center",
                className
            )}
        >
            <div
                className={cn(
                    "mb-4 rounded-full bg-muted p-4",
                    variant !== "default" && `bg-${variant}/10`
                )}
            >
                <Icon className={cn("h-8 w-8", variantStyles[variant])} />
            </div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
            {action && (
                <Button onClick={action.onClick} className="mt-4" variant="outline">
                    {action.label}
                </Button>
            )}
        </div>
    )
}
