export const env = {
  VITE_REOWN_PROJECT_ID: import.meta.env.VITE_REOWN_PROJECT_ID as string,

  VITE_API_URL: (import.meta.env.VITE_API_URL ||
    'http://localhost:8081') as string,

  VITE_WITHDRAWAL_LOCK_DAYS: (() => {
    const value = Number(import.meta.env.VITE_WITHDRAWAL_LOCK_DAYS)
    if (Number.isFinite(value)) {
      return Math.max(0, value)
    }
    return 7
  })(),
} as const

export type Env = typeof env
