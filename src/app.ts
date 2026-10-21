/**
 * Svelar Application Bootstrap
 *
 * Configures database, hashing, auth, cache, queue, audit, API keys,
 * webhooks, teams, uploads, email templates, feature flags, PDF, and scheduling.
 * This runs once when the server starts.
 */

import { Connection } from '@beeblock/svelar/database';
import { isolateSqliteTransactions } from '$lib/database/sqlite-transactions.js';
import { config } from '@beeblock/svelar/config';
import { Hash } from '@beeblock/svelar/hashing';
import { AuthManager } from '@beeblock/svelar/auth';
import { Cache } from '@beeblock/svelar/cache';
import { Queue } from '@beeblock/svelar/queue';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { Audit } from '@beeblock/svelar/audit';
import { ApiKeys } from '@beeblock/svelar/api-keys';
import { Webhooks } from '@beeblock/svelar/webhooks';
	import { Teams } from '@beeblock/svelar/teams';
	import { EmailTemplates } from '@beeblock/svelar/email-templates';
	import { Mailer } from '@beeblock/svelar/mail';
	import { Uploads } from '@beeblock/svelar/uploads';
import { Features } from '@beeblock/svelar/feature-flags';
import { PDF } from '@beeblock/svelar/pdf';
import { configureDashboard } from '@beeblock/svelar/dashboard';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { createScheduler } from '$lib/shared/scheduler/index.js';
import { User } from '$lib/modules/auth/domain/models/User.js';
import { EventServiceProvider } from '$lib/shared/providers/EventServiceProvider.js';
import { container } from '@beeblock/svelar/container';
import '$lib/modules/auth/domain/policies/gates.js';
import '$lib/modules/collaboration/app.js';

await config.loadFromDirectory('config');

// ── Database ───────────────────────────────────────────────
Connection.configure({
  default: config.get('database.default', process.env.DB_DRIVER ?? 'sqlite'),
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: config.get('database.connections.sqlite.filename', process.env.DB_PATH ?? 'database.db'),
    },
    postgres: {
      driver: 'postgres',
      url: config.get('database.connections.postgres.url', process.env.DATABASE_URL),
      host: config.get('database.connections.postgres.host', process.env.DB_HOST ?? 'localhost'),
      port: config.get('database.connections.postgres.port', Number(process.env.DB_PORT ?? 5432)),
      database: config.get('database.connections.postgres.database', process.env.DB_NAME ?? 'svelar_db'),
      user: config.get('database.connections.postgres.user', process.env.DB_USER ?? 'postgres'),
      password: config.get('database.connections.postgres.password', process.env.DB_PASSWORD ?? ''),
      prepare: config.get(
        'database.connections.postgres.prepare',
        process.env.DB_PREPARE ? process.env.DB_PREPARE !== 'false' : process.env.DB_HOST !== 'pgbouncer'
      ),
    },
    mysql: {
      driver: 'mysql',
      url: config.get('database.connections.mysql.url', process.env.DATABASE_URL),
      host: config.get('database.connections.mysql.host', process.env.DB_HOST ?? 'localhost'),
      port: config.get('database.connections.mysql.port', Number(process.env.DB_PORT ?? 3306)),
      database: config.get('database.connections.mysql.database', process.env.DB_NAME ?? 'svelar_db'),
      user: config.get('database.connections.mysql.user', process.env.DB_USER ?? 'root'),
      password: config.get('database.connections.mysql.password', process.env.DB_PASSWORD ?? ''),
    },
  },
});
// Other requests' statements must never join (and roll back with) an open SQLite transaction.
isolateSqliteTransactions();

// ── Hashing (scrypt, zero dependencies) ───────────────────
Hash.configure({ driver: 'scrypt' });

// ── Auth (session-based with password reset, email verification, OTP) ──
export const auth = new AuthManager({
  guard: config.get('auth.guard', 'session'),
  model: User,
  jwt: {
    secret: config.get('auth.jwt.secret', process.env.JWT_SECRET ?? process.env.APP_KEY),
  },
  appUrl: config.get('app.url', process.env.APP_URL ?? 'http://localhost:5173'),
  appName: config.get('app.name', process.env.APP_NAME ?? 'Svelar'),
});

// ── Cache ─────────────────────────────────────────────────
Cache.configure({
  default: config.get('cache.default', process.env.CACHE_DRIVER ?? 'memory'),
  stores: {
    memory: {
      driver: 'memory',
      ttl: config.get('cache.stores.memory.ttl', undefined),
    },
    file: {
      driver: 'file',
      path: config.get('cache.stores.file.path', 'storage/cache'),
      ttl: config.get('cache.stores.file.ttl', undefined),
    },
    redis: {
      driver: 'redis',
      url: config.get('cache.stores.redis.url', process.env.REDIS_URL),
      host: config.get('cache.stores.redis.host', process.env.REDIS_HOST ?? 'localhost'),
      port: config.get('cache.stores.redis.port', Number(process.env.REDIS_PORT ?? 6379)),
      password: config.get('cache.stores.redis.password', process.env.REDIS_PASSWORD),
      db: config.get('cache.stores.redis.db', Number(process.env.REDIS_DB ?? 0)),
      prefix: config.get('cache.stores.redis.prefix', 'svelar_cache:'),
      ttl: config.get('cache.stores.redis.ttl', undefined),
    },
  },
});

// ── Queue ─────────────────────────────────────────────────
const queueConnections: Record<string, any> = {
  sync: { driver: 'sync' },
  memory: { driver: 'memory' },
  database: {
    driver: 'database',
    table: config.get('queue.connections.database.table', 'svelar_jobs'),
  },
  redis: {
    driver: 'redis',
    url: config.get('queue.connections.redis.url', process.env.REDIS_URL),
    host: config.get('queue.connections.redis.host', process.env.REDIS_HOST ?? 'localhost'),
    port: config.get('queue.connections.redis.port', Number(process.env.REDIS_PORT ?? 6379)),
    password: config.get('queue.connections.redis.password', process.env.REDIS_PASSWORD),
    db: config.get('queue.connections.redis.db', Number(process.env.REDIS_DB ?? 0)),
    prefix: config.get('queue.connections.redis.prefix', 'svelar'),
  },
};
const queueConfig = {
  default: config.get('queue.default', process.env.QUEUE_DRIVER ?? 'sync'),
  connections: queueConnections,
};
Queue.configure(queueConfig);
JobMonitor.configure({ driver: queueConfig.connections[queueConfig.default]?.driver ?? queueConfig.default, ...queueConfig });

// ── Audit Logging ─────────────────────────────────────────
Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true });

// ── API Keys ──────────────────────────────────────────────
ApiKeys.configure({ driver: 'database', prefix: 'sk_' });

// ── Webhooks ──────────────────────────────────────────────
Webhooks.configure({ driver: 'database', maxAttempts: 5 });

// ── Teams ─────────────────────────────────────────────────
Teams.configure({ driver: 'database' });

// ── Uploads ───────────────────────────────────────────────
Uploads.configure({ driver: 'database', maxFileSize: 10 * 1024 * 1024 });

// ── Email Templates ──────────────────────────────────────
EmailTemplates.configure({ driver: 'database' });
EmailTemplates.registerDefaults();

// ── Broadcasting (SSE) ────────────────────────────────────
Broadcast.configure({
  default: 'sse',
  drivers: {
    sse: { driver: 'sse' },
  },
});

// Channel authorization — private-user-{id} for per-user channels
Broadcast.channel('private-user-{id}', async (user: any, params: any) => {
  return user && String(user.id) === params.id;
});

// Presence channel for admin dashboard
Broadcast.channel('presence-admin', async (user: any) => {
  if (!user || user.role !== 'admin') return false;
  return { id: user.id, name: user.name };
});

	// ── Feature Flags ────────────────────────────────────────
	Features.configure({ driver: 'database' });

	// ── Mail ─────────────────────────────────────────────────
	const mailDefault = config.get('mail.default', config.get('mail.driver', process.env.MAIL_DRIVER ?? 'log'));
	Mailer.configure({
	  default: mailDefault,
	  from: {
	    address: config.get('mail.from.address', process.env.MAIL_FROM ?? 'hello@example.com'),
	    name: config.get('mail.from.name', process.env.MAIL_FROM_NAME ?? process.env.APP_NAME ?? 'Svelar'),
	  },
	  mailers: {
	    log: { driver: 'log' },
	    null: { driver: 'null' },
	    smtp: {
	      driver: 'smtp',
	      host: config.get('mail.mailers.smtp.host', config.get('mail.smtp.host', process.env.MAIL_HOST ?? process.env.SMTP_HOST ?? 'localhost')),
	      port: Number(config.get('mail.mailers.smtp.port', config.get('mail.smtp.port', process.env.MAIL_PORT ?? process.env.SMTP_PORT ?? 587))),
	      secure: config.get('mail.mailers.smtp.secure', config.get('mail.smtp.secure', process.env.MAIL_SECURE === 'true')),
	      auth: {
	        user: config.get('mail.mailers.smtp.auth.user', config.get('mail.smtp.user', process.env.MAIL_USER ?? process.env.SMTP_USER ?? '')),
	        pass: config.get('mail.mailers.smtp.auth.pass', config.get('mail.smtp.password', process.env.MAIL_PASSWORD ?? process.env.SMTP_PASSWORD ?? '')),
	      },
	    },
	    postmark: {
	      driver: 'postmark',
	      apiToken: config.get('mail.mailers.postmark.apiToken', process.env.POSTMARK_API_TOKEN ?? ''),
	      messageStream: config.get('mail.mailers.postmark.messageStream', process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound'),
	      endpoint: config.get('mail.mailers.postmark.endpoint', process.env.POSTMARK_ENDPOINT),
	    },
	    resend: {
	      driver: 'resend',
	      apiKey: config.get('mail.mailers.resend.apiKey', process.env.RESEND_API_KEY ?? ''),
	      endpoint: config.get('mail.mailers.resend.endpoint', process.env.RESEND_ENDPOINT),
	    },
	    mailtrap: {
	      driver: 'mailtrap',
	      apiToken: config.get('mail.mailers.mailtrap.apiToken', process.env.MAILTRAP_API_TOKEN ?? ''),
	      endpoint: config.get('mail.mailers.mailtrap.endpoint', process.env.MAILTRAP_ENDPOINT),
	    },
	  },
	});

	// ── PDF ─────────────────────────────────────────────────
const pdfDriver = config.get('pdf.driver', process.env.PDF_DRIVER ?? 'pdfkit') as 'pdfkit' | 'gotenberg';
const parseDurationMs = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;

  const match = value.trim().match(/^(\d+)(ms|s|m)?$/);
  if (!match) return fallback;

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  if (unit === 'm') return amount * 60_000;
  if (unit === 's') return amount * 1_000;
  return amount;
};

PDF.configure({
  driver: pdfDriver,
  gotenberg: {
    url: config.get('pdf.gotenberg.url', process.env.GOTENBERG_URL ?? 'http://localhost:3000'),
    timeout: parseDurationMs(config.get('pdf.gotenberg.timeout', process.env.GOTENBERG_TIMEOUT ?? '60s'), 60_000),
  },
});

// ── Dashboard ─────────────────────────────────────────────
configureDashboard({ enabled: true, prefix: '/admin' });

// ── Scheduler ─────────────────────────────────────────────
export const scheduler = createScheduler();

// ── Job Registration ──────────────────────────────────────
import { SendWelcomeEmail } from '$lib/shared/jobs/SendWelcomeEmail.js';
import { DailyDigestJob } from '$lib/shared/jobs/DailyDigestJob.js';
import { ExportDataJob } from '$lib/shared/jobs/ExportDataJob.js';
import { RunAutomationJob } from '$lib/modules/agent-room/application/jobs/RunAutomationJob.js';

Queue.registerAll([SendWelcomeEmail, DailyDigestJob, ExportDataJob, RunAutomationJob]);

// ── Events (boot listeners + observers) ──────────────────
const esp = new EventServiceProvider(container);
await esp.boot();

// ── Auth Feature Toggles ─────────────────────────────────
export const authConfig = {
  otpEnabled: process.env.AUTH_OTP_ENABLED !== 'false',
  emailVerificationRequired: process.env.AUTH_EMAIL_VERIFICATION_REQUIRED === 'true',
};

export { Connection, Hash, Broadcast };
