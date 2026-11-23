import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export type LogCategory =
  | 'DISCORD'
  | 'MONGODB'
  | 'REDIS'
  | 'SYNC'
  | 'ANTIRAID'
  | 'PERMISSIONS'
  | 'SANCTION'
  | 'AUTH'
  | 'WORKER'
  | 'GLOBALBAN'
  | 'AUDIT'
  | 'SYSTEM';

export interface StructuredLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: 'api' | 'bot' | 'worker' | 'core';
  category: LogCategory;
  message: string;
  correlationId?: string;
  guildId?: string;
  userId?: string;
  actionId?: string;
  syncVersion?: number;
  durationMs?: number;
  errorCode?: string | number;
  meta?: Record<string, unknown>;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|cookie|authorization|session|encryption|uri|redisurl|mongo|totp|recovery|bearer|clientsecret)/i;

const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROTATED_FILES = 5;
const MAX_RING_ENTRIES = 300;

function resolveConfiguredMinWeight(): number {
  const raw = (process.env.LOG_LEVEL || 'info').trim().toUpperCase();
  if (raw === 'DEBUG') return LEVEL_WEIGHT.DEBUG;
  if (raw === 'WARN' || raw === 'WARNING') return LEVEL_WEIGHT.WARN;
  if (raw === 'ERROR') return LEVEL_WEIGHT.ERROR;
  if (raw === 'FATAL') return LEVEL_WEIGHT.FATAL;
  return LEVEL_WEIGHT.INFO;
}

export function redactSensitiveString(input: string): string {
  return input
    .replace(/\b(Bot|Bearer)\s+[A-Za-z0-9._-]{8,}/gi, '$1 [REDACTED]')
    .replace(/(mongodb(?:\+srv)?:\/\/)([^@\s/]+@)?([^\s]+)/gi, '$1[REDACTED]@$3')
    .replace(/(rediss?:\/\/)([^@\s/]+@)?([^\s]+)/gi, '$1[REDACTED]@$3')
    .replace(/([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,})/g, '[REDACTED_JWT_OR_TOKEN]');
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveString(value).slice(0, 600);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveString(value.message).slice(0, 400),
      code: (value as { code?: unknown }).code ?? undefined,
    };
  }
  if (depth >= 3) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeLogValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

class AegisStructuredLogger {
  private readonly ring: StructuredLogEntry[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private readonly logDir = path.join(process.cwd(), '.aegis-data', 'logs');

  createCorrelationId(prefix = 'evt'): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  getRecentEntries(filter?: {
    guildId?: string;
    level?: LogLevel;
    category?: LogCategory;
    limit?: number;
  }): StructuredLogEntry[] {
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 50));
    const result: StructuredLogEntry[] = [];
    for (let i = this.ring.length - 1; i >= 0 && result.length < limit; i--) {
      const entry = this.ring[i];
      if (filter?.guildId && entry.guildId !== filter.guildId) continue;
      if (filter?.level && entry.level !== filter.level) continue;
      if (filter?.category && entry.category !== filter.category) continue;
      result.push(entry);
    }
    return result;
  }

  log(
    level: LogLevel,
    params: {
      service?: StructuredLogEntry['service'];
      category: LogCategory;
      message: string;
      correlationId?: string;
      guildId?: string;
      userId?: string;
      actionId?: string;
      syncVersion?: number;
      durationMs?: number;
      errorCode?: string | number;
      meta?: Record<string, unknown>;
    }
  ): StructuredLogEntry | null {
    if (LEVEL_WEIGHT[level] < resolveConfiguredMinWeight()) {
      return null;
    }

    const entry: StructuredLogEntry = {
      id: `log_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      level,
      service: params.service ?? 'core',
      category: params.category,
      message: redactSensitiveString(params.message),
      ...(params.correlationId ? { correlationId: params.correlationId } : {}),
      ...(params.guildId ? { guildId: params.guildId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.actionId ? { actionId: params.actionId } : {}),
      ...(params.syncVersion !== undefined ? { syncVersion: params.syncVersion } : {}),
      ...(params.durationMs !== undefined
        ? { durationMs: Number(params.durationMs.toFixed(2)) }
        : {}),
      ...(params.errorCode !== undefined ? { errorCode: params.errorCode } : {}),
      ...(params.meta
        ? { meta: sanitizeLogValue(params.meta) as Record<string, unknown> }
        : {}),
    };

    this.ring.push(entry);
    if (this.ring.length > MAX_RING_ENTRIES) {
      this.ring.shift();
    }

    if (process.env.NODE_ENV !== 'test') {
      const line = JSON.stringify(entry);
      if (level === 'ERROR' || level === 'FATAL') {
        console.error(line);
      } else if (level === 'WARN') {
        console.warn(line);
      } else {
        console.info(line);
      }
      this.enqueueFileWrite(entry.service, `${line}\n`);
    }

    return entry;
  }

  debug(category: LogCategory, message: string, opts: Omit<Parameters<AegisStructuredLogger['log']>[1], 'category' | 'message'> = {}) {
    return this.log('DEBUG', { ...opts, category, message });
  }

  info(category: LogCategory, message: string, opts: Omit<Parameters<AegisStructuredLogger['log']>[1], 'category' | 'message'> = {}) {
    return this.log('INFO', { ...opts, category, message });
  }

  warn(category: LogCategory, message: string, opts: Omit<Parameters<AegisStructuredLogger['log']>[1], 'category' | 'message'> = {}) {
    return this.log('WARN', { ...opts, category, message });
  }

  error(category: LogCategory, message: string, opts: Omit<Parameters<AegisStructuredLogger['log']>[1], 'category' | 'message'> = {}) {
    return this.log('ERROR', { ...opts, category, message });
  }

  fatal(category: LogCategory, message: string, opts: Omit<Parameters<AegisStructuredLogger['log']>[1], 'category' | 'message'> = {}) {
    return this.log('FATAL', { ...opts, category, message });
  }

  private enqueueFileWrite(service: string, line: string): void {
    const filePath = path.join(this.logDir, `aegis-${service}.log`);
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.promises.mkdir(this.logDir, { recursive: true, mode: 0o700 });
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.size >= MAX_LOG_FILE_BYTES) {
            await this.rotateLogFile(filePath);
          }
        } catch {
          // File doesn't exist yet
        }
        await fs.promises.appendFile(filePath, line, { encoding: 'utf8', mode: 0o600 });
      })
      .catch(() => {
        // Never crash runtime if disk is read-only
      });
  }

  private async rotateLogFile(filePath: string): Promise<void> {
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      const dest = `${filePath}.${i + 1}`;
      try {
        await fs.promises.rename(src, dest);
      } catch {
        // Ignore missing rotated slot
      }
    }
    try {
      await fs.promises.rename(filePath, `${filePath}.1`);
    } catch {
      // Ignore rename race
    }
  }
}

const globalForLogger = globalThis as unknown as { __aegisLogger?: AegisStructuredLogger };
export const aegisLogger = globalForLogger.__aegisLogger ?? new AegisStructuredLogger();
if (!globalForLogger.__aegisLogger) {
  globalForLogger.__aegisLogger = aegisLogger;
}
