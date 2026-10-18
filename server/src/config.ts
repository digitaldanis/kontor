export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export interface Config {
  port: number
  dataDir: string
  /** Key material for encrypting stored SMTP passwords. */
  secret: string
  /** "first" allows only the first account, "open" anyone, "closed" nobody. */
  signup: 'first' | 'open' | 'closed'
  corsOrigins: string[]
  staticDir: string
  /** Optional server-wide SMTP account, used when a user has none of their own. */
  smtp: SmtpConfig | null
  sessionDays: number
  maxBodyMb: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const smtpHost = env.SMTP_HOST?.trim()
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: env.DATA_DIR ?? './data',
    secret: env.KONTOR_SECRET ?? '',
    signup: env.ALLOW_SIGNUP === 'true' ? 'open' : env.ALLOW_SIGNUP === 'false' ? 'closed' : 'first',
    corsOrigins: (env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    staticDir: env.STATIC_DIR ?? '',
    smtp: smtpHost
      ? {
          host: smtpHost,
          port: Number(env.SMTP_PORT ?? 587),
          secure: env.SMTP_SECURE === 'true',
          user: env.SMTP_USER ?? '',
          password: env.SMTP_PASSWORD ?? '',
          from: env.SMTP_FROM ?? env.SMTP_USER ?? '',
        }
      : null,
    sessionDays: Number(env.SESSION_DAYS ?? 90),
    maxBodyMb: Number(env.MAX_BODY_MB ?? 30),
  }
}
