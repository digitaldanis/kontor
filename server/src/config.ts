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
  /** "first" allows only the owner account, "open" anyone, "closed" nobody (members are added by the owner). */
  signup: 'first' | 'open' | 'closed'
  /** Built web app served next to the API. */
  staticDir: string
  /** Secure cookies; on by default in production. */
  secureCookies: boolean
  /** Server-wide SMTP account, used when a workspace has none of its own. */
  smtp: SmtpConfig | null
  sessionDays: number
  maxBodyMb: number
  backupKeepDays: number
  /** Hours between automatic database backups, 0 disables them. */
  backupIntervalHours: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const smtpHost = env.SMTP_HOST?.trim()
  const production = env.NODE_ENV === 'production'
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: env.DATA_DIR ?? './data',
    secret: env.KONTOR_SECRET ?? '',
    signup: env.ALLOW_SIGNUP === 'true' ? 'open' : env.ALLOW_SIGNUP === 'false' ? 'closed' : 'first',
    staticDir: env.STATIC_DIR ?? (production ? './dist' : ''),
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
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
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    maxBodyMb: Number(env.MAX_BODY_MB ?? 60),
    backupKeepDays: Number(env.BACKUP_KEEP_DAYS ?? 14),
    backupIntervalHours: Number(env.BACKUP_INTERVAL_HOURS ?? 24),
  }
}
