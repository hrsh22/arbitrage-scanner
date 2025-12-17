"use client"

import { useEffect } from "react"
import { OpportunityFilter } from "@/lib/types"

type FiltersProps = {
  filter: OpportunityFilter
  onChange: (next: OpportunityFilter) => void
  onRefreshIntervalChange: (ms: number) => void
  refreshMs: number
}

const sortOptions = [
  { value: "score", label: "Score" },
  { value: "profit", label: "Profit %" },
  { value: "liquidity", label: "Liquidity" },
  { value: "newest", label: "Newest" },
]

const refreshOptions = [
  { value: 30000, label: "30s" },
  { value: 60000, label: "60s" },
  { value: 120000, label: "2m" },
]

export function Filters({ filter, onChange, onRefreshIntervalChange, refreshMs }: FiltersProps) {
  useEffect(() => {
    const stored = localStorage.getItem("pm-filters")
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as OpportunityFilter
        onChange({ ...filter, ...parsed })
      } catch {
        // ignore invalid stored data
      }
    }
    const storedRefresh = localStorage.getItem("pm-refresh")
    if (storedRefresh) {
      const parsed = Number(storedRefresh)
      if (Number.isFinite(parsed)) onRefreshIntervalChange(parsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateFilter = (patch: Partial<OpportunityFilter>) => {
    const next = { ...filter, ...patch }
    onChange(next)
    localStorage.setItem("pm-filters", JSON.stringify(next))
  }

  const updateRefresh = (value: number) => {
    onRefreshIntervalChange(value)
    localStorage.setItem("pm-refresh", value.toString())
  }

  return (
    <div className="grid gap-4 rounded-lg border border-slate-200 bg-white/40 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Min Profit %
          <input
            type="number"
            min={0}
            step={0.1}
            value={filter.minProfitPct}
            onChange={(e) => updateFilter({ minProfitPct: Number(e.target.value) || 0 })}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner dark:border-slate-800 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Min Liquidity (USD)
          <input
            type="number"
            min={0}
            step={10}
            value={filter.minLiquidity}
            onChange={(e) => updateFilter({ minLiquidity: Number(e.target.value) || 0 })}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner dark:border-slate-800 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Sort By
          <select
            value={filter.sort}
            onChange={(e) => updateFilter({ sort: e.target.value as OpportunityFilter["sort"] })}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-inner dark:border-slate-800 dark:bg-slate-900"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Refresh:</span>
          {refreshOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateRefresh(opt.value)}
              className={`rounded-md border px-2 py-1 ${refreshMs === opt.value
                ? "border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                : "border-transparent bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="text-slate-500 dark:text-slate-400">Auto-refresh every {refreshMs / 1000}s</div>
      </div>
    </div>
  )
}
