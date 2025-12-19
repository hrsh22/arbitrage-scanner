import { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

interface StatCardProps {
    title: string
    value: string | number
    subtitle?: string
    icon: LucideIcon
    variant?: "default" | "profit" | "polymarket" | "kalshi" | "warning"
    className?: string
}

const variantStyles = {
    default: "bg-muted/50 text-muted-foreground",
    profit: "bg-profit/10 text-profit",
    polymarket: "bg-polymarket/10 text-polymarket",
    kalshi: "bg-kalshi/10 text-kalshi",
    warning: "bg-warning/10 text-warning",
}

export function StatCard({
    title,
    value,
    subtitle,
    icon: Icon,
    variant = "default",
    className,
}: StatCardProps) {
    return (
        <Card className={cn("overflow-hidden", className)}>
            <CardContent className="p-4">
                <div className="flex items-center gap-3">
                    <div className={cn("rounded-lg p-2", variantStyles[variant])}>
                        <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm text-muted-foreground truncate">{title}</p>
                        <p className="text-2xl font-bold tracking-tight">{value}</p>
                        {subtitle && (
                            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
