import { OpportunityFilter, OpportunitiesResponse, OpportunityStats, HistoryResponse, NearResolutionFilter, NearResolutionResponse, CrossPlatformResponse } from "./types"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ""

const makeUrl = (path: string, qs?: string) => `${API_BASE}${path}${qs ? `?${qs}` : ""}`

const buildQuery = (filter: OpportunityFilter) => {
  const params = new URLSearchParams()
  if (filter.minProfitPct > 0) params.set("minProfitPct", filter.minProfitPct.toString())
  if (filter.minLiquidity > 0) params.set("minLiquidity", filter.minLiquidity.toString())
  if (filter.sort) params.set("sort", filter.sort)
  return params.toString()
}

const buildNearResolutionQuery = (filter: NearResolutionFilter) => {
  const params = new URLSearchParams()
  params.set("maxHours", filter.maxHours.toString())
  params.set("minOdds", filter.minOdds.toString())
  if (filter.sort) params.set("sort", filter.sort)
  return params.toString()
}

export async function fetchOpportunities(
  filter: OpportunityFilter,
  signal?: AbortSignal
): Promise<OpportunitiesResponse> {
  const qs = buildQuery(filter)
  const res = await fetch(makeUrl("/opportunities", qs), { signal, cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to load opportunities (${res.status})`)
  }
  return res.json()
}

export async function fetchNearResolution(
  filter: NearResolutionFilter,
  signal?: AbortSignal
): Promise<NearResolutionResponse> {
  const qs = buildNearResolutionQuery(filter)
  const res = await fetch(makeUrl("/opportunities/near-resolution", qs), { signal, cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to load near-resolution opportunities (${res.status})`)
  }
  return res.json()
}

export async function fetchHistory(limit = 100, signal?: AbortSignal): Promise<HistoryResponse> {
  const res = await fetch(makeUrl("/opportunities/history", `limit=${limit}`), { signal, cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to load history (${res.status})`)
  }
  return res.json()
}

export async function fetchStats(signal?: AbortSignal): Promise<OpportunityStats> {
  const res = await fetch(makeUrl("/opportunities/stats"), { signal, cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to load stats (${res.status})`)
  }
  const json = await res.json()
  const num = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return {
    opportunities: {
      total: num(json?.opportunities?.total),
      active: num(json?.opportunities?.active),
      expired: num(json?.opportunities?.expired),
      potentialProfit: num(json?.opportunities?.potentialProfit),
    },
    actions: {
      executed: num(json?.actions?.executed),
      missed: num(json?.actions?.missed),
      actualProfit: num(json?.actions?.actualProfit),
    },
  }
}

export async function postAction(key: string, action: "executed" | "missed"): Promise<void> {
  const res = await fetch(makeUrl(`/opportunities/${encodeURIComponent(key)}/action`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) {
    throw new Error(`Failed to record action (${res.status})`)
  }
}

export async function fetchCrossPlatform(
  minConfidence = 0,
  signal?: AbortSignal
): Promise<CrossPlatformResponse> {
  const qs = minConfidence > 0 ? `minConfidence=${minConfidence}` : ""
  const res = await fetch(makeUrl("/cross-platform", qs), { signal, cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to load cross-platform opportunities (${res.status})`)
  }
  return res.json()
}
