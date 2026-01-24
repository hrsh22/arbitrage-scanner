export const env = {
  VITE_REOWN_PROJECT_ID: import.meta.env.VITE_REOWN_PROJECT_ID as string,

  VITE_API_URL: (import.meta.env.VITE_API_URL ||
    'http://localhost:8081') as string,
} as const

export type Env = typeof env
