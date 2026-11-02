export interface Env {
  DB: D1Database;
  STATEMENTS: R2Bucket;
  ASSETS: Fetcher;
  UPLOAD_LIMITER?: RateLimit;
  APP_ENV: 'dev' | 'test' | 'preview' | 'production';
  APP_VERSION: string;
  AUTH_MODE: 'dev' | 'access';
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Comma-separated allow-list (secret). */
  ALLOWED_EMAILS?: string;
  ASYNC_MODE: 'inline' | 'queue';
  AI_ENABLED: string;
  /** Workers AI binding (optional; only used when AI_ENABLED = "true"). */
  AI?: Ai;
  /** Workers AI model id override (default in services/ai.ts). */
  AI_MODEL?: string;
  /** Comma-separated envelope senders allowed to forward alert e-mails (secret). Empty = off. */
  ALERT_SENDERS?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AppVariables {
  requestId: string;
  user: AuthUser;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
