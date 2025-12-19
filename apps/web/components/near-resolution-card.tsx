"use client"

import { NearResolutionOpportunity } from "@/lib/types"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ExternalLink, Clock, TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

type Props = {
    opportunity: NearResolutionOpportunity
}

function formatTimeLeft(hours: number): string {
    if (hours < 1) {
        const minutes = Math.floor(hours * 60)
        return `${minutes}m`
    }
    if (hours < 24) {
        return `${Math.floor(hours)}h`
    }
    const days = Math.floor(hours / 24)
    const remainingHours = Math.floor(hours % 24)
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

function getUrgencyVariant(hours: number): "destructive" | "warning" | "default" {
    if (hours < 6) return "destructive"
    if (hours < 24) return "warning"
    return "default"
}

export function NearResolutionCard({ opportunity }: Props) {
    const probability = opportunity.likelyOutcome.probability * 100
    const potentialProfit = opportunity.potentialProfit * 100
    const expectedValue = opportunity.expectedValue * 100
    const buyPrice = opportunity.likelyOutcome.bestAsk * 100

    const marketUrl = opportunity.eventSlug
        ? `https://polymarket.com/event/${opportunity.eventSlug}`
        : opportunity.marketSlug
            ? `https://polymarket.com/event/${opportunity.marketSlug}`
            : null

    const urgency = getUrgencyVariant(opportunity.hoursUntilClose)

    return (
        <Card className="overflow-hidden transition-shadow hover:shadow-md border-kalshi/20">
            <CardContent className="p-4">
                {/* Header Row */}
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={urgency === "destructive" ? "destructive" : "outline"} className={cn(
                            urgency === "warning" && "border-warning text-warning",
                            urgency === "default" && "border-kalshi/50 text-kalshi"
                        )}>
                            <Clock className="mr-1 h-3 w-3" />
                            {formatTimeLeft(opportunity.hoursUntilClose)} left
                        </Badge>
                        <Badge variant="secondary">
                            {probability.toFixed(0)}% → {opportunity.likelyOutcome.name}
                        </Badge>
                    </div>
                    <div className="text-right">
                        <div className={cn(
                            "text-xl font-bold",
                            expectedValue > 0 ? "text-profit" : "text-destructive"
                        )}>
                            {expectedValue > 0 ? "+" : ""}{expectedValue.toFixed(1)}¢ EV
                        </div>
                    </div>
                </div>

                {/* Question */}
                <h3 className="font-medium mb-3 line-clamp-2">{opportunity.question}</h3>

                {/* Strategy Breakdown - Compact */}
                <div className="rounded-lg bg-muted/50 p-3 mb-4">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                            <p className="text-muted-foreground text-xs mb-0.5">Buy at</p>
                            <p className="font-medium">{buyPrice.toFixed(1)}¢</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
                                <TrendingUp className="h-3 w-3 text-profit" />
                                If correct
                            </p>
                            <p className="font-medium text-profit">+{potentialProfit.toFixed(1)}¢</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
                                <TrendingDown className="h-3 w-3 text-destructive" />
                                If wrong
                            </p>
                            <p className="font-medium text-destructive">-{buyPrice.toFixed(1)}¢</p>
                        </div>
                    </div>
                </div>

                {/* Stats Row */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4 text-sm">
                    <div className="flex items-center gap-4 text-muted-foreground">
                        <span>Closes: {new Date(opportunity.closesAt).toLocaleString()}</span>
                        {opportunity.likelyOutcome.liquidity > 0 && (
                            <span>Liquidity: ${opportunity.likelyOutcome.liquidity.toFixed(0)}</span>
                        )}
                    </div>
                </div>

                {/* Action */}
                {marketUrl && (
                    <Button asChild size="sm" className="bg-kalshi hover:bg-kalshi/90">
                        <a href={marketUrl} target="_blank" rel="noreferrer">
                            Trade on Polymarket
                            <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                    </Button>
                )}
            </CardContent>
        </Card>
    )
}
