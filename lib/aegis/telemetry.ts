import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

export interface LatencyPercentiles {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface ActionCountersSnapshot {
  threatsDetected: number;
  threatsInvestigated: number;
  actionsAttempted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  actionsCancelled: number;
  lastEventAt: string | null;
  lastDetectorRunAt: string | null;
  lastSuccessfulActionAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface RuntimeTelemetrySnapshot {
  antiRaidEvalLatency: LatencyPercentiles;
  sanctionExecLatency: LatencyPercentiles;
  cpuPercent: number;
  memoryMb: number;
  eventLoopLagMs: number;
  eventThroughputPerSec: number;
  counters: ActionCountersSnapshot;
}

const MAX_LATENCY_SAMPLES = 512;

class BoundedLatencyTracker {
  private readonly samples: number[] = [];
  private cursor = 0;
  private totalCount = 0;

  record(durationMs: number): void {
    const clean = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    if (this.samples.length < MAX_LATENCY_SAMPLES) {
      this.samples.push(clean);
    } else {
      this.samples[this.cursor] = clean;
      this.cursor = (this.cursor + 1) % MAX_LATENCY_SAMPLES;
    }
    this.totalCount += 1;
  }

  getPercentiles(): LatencyPercentiles {
    if (this.samples.length === 0) {
      return { count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pick = (q: number) => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
      return Number(sorted[idx].toFixed(3));
    };
    return {
      count: this.totalCount,
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
      p99Ms: pick(0.99),
      maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
    };
  }
}

class AegisTelemetryRegistry {
  public readonly evalLatency = new BoundedLatencyTracker();
  public readonly sanctionLatency = new BoundedLatencyTracker();
  private readonly guildCounters = new Map<string, ActionCountersSnapshot>();
  private readonly globalCounters: ActionCountersSnapshot = {
    threatsDetected: 0,
    threatsInvestigated: 0,
    actionsAttempted: 0,
    actionsSucceeded: 0,
    actionsFailed: 0,
    actionsCancelled: 0,
    lastEventAt: null,
    lastDetectorRunAt: null,
    lastSuccessfulActionAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };

  private eventTimestamps: number[] = [];
  private eventHead = 0;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleMs = Date.now();
  private lastCpuPercent = 0;
  private loopMonitor: IntervalHistogram | null = null;

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      try {
        this.loopMonitor = monitorEventLoopDelay({ resolution: 20 });
        this.loopMonitor.enable();
      } catch {
        this.loopMonitor = null;
      }
    }
  }

  private getOrCreateGuildCounters(guildId: string): ActionCountersSnapshot {
    let entry = this.guildCounters.get(guildId);
    if (!entry) {
      entry = {
        threatsDetected: 0,
        threatsInvestigated: 0,
        actionsAttempted: 0,
        actionsSucceeded: 0,
        actionsFailed: 0,
        actionsCancelled: 0,
        lastEventAt: null,
        lastDetectorRunAt: null,
        lastSuccessfulActionAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      };
      this.guildCounters.set(guildId, entry);
    }
    return entry;
  }

  recordEventProcessed(guildId?: string, nowMs = Date.now()): void {
    const iso = new Date(nowMs).toISOString();
    this.globalCounters.lastEventAt = iso;
    if (guildId) {
      this.getOrCreateGuildCounters(guildId).lastEventAt = iso;
    }
    this.eventTimestamps.push(nowMs);
    const cutoff = nowMs - 10_000;
    while (this.eventHead < this.eventTimestamps.length && this.eventTimestamps[this.eventHead] < cutoff) {
      this.eventHead += 1;
    }
    if (this.eventHead >= 256 && this.eventHead * 2 >= this.eventTimestamps.length) {
      this.eventTimestamps = this.eventTimestamps.slice(this.eventHead);
      this.eventHead = 0;
    }
  }

  recordDetectorRun(guildId: string, durationMs: number, detected: boolean, investigated = true): void {
    this.evalLatency.record(durationMs);
    const iso = new Date().toISOString();
    const g = this.getOrCreateGuildCounters(guildId);
    this.globalCounters.lastDetectorRunAt = iso;
    g.lastDetectorRunAt = iso;
    if (investigated) {
      this.globalCounters.threatsInvestigated += 1;
      g.threatsInvestigated += 1;
    }
    if (detected) {
      this.globalCounters.threatsDetected += 1;
      g.threatsDetected += 1;
    }
  }

  recordSanctionOutcome(params: {
    guildId: string;
    outcome: 'SUCCESS' | 'FAILED' | 'CANCELLED';
    durationMs: number;
    errorMessage?: string | null;
  }): void {
    this.sanctionLatency.record(params.durationMs);
    const iso = new Date().toISOString();
    const g = this.getOrCreateGuildCounters(params.guildId);

    this.globalCounters.actionsAttempted += 1;
    g.actionsAttempted += 1;

    if (params.outcome === 'SUCCESS') {
      this.globalCounters.actionsSucceeded += 1;
      g.actionsSucceeded += 1;
      this.globalCounters.lastSuccessfulActionAt = iso;
      g.lastSuccessfulActionAt = iso;
    } else if (params.outcome === 'FAILED') {
      this.globalCounters.actionsFailed += 1;
      g.actionsFailed += 1;
      this.globalCounters.lastErrorAt = iso;
      g.lastErrorAt = iso;
      this.globalCounters.lastErrorMessage = params.errorMessage ?? 'Action failed';
      g.lastErrorMessage = params.errorMessage ?? 'Action failed';
    } else {
      this.globalCounters.actionsCancelled += 1;
      g.actionsCancelled += 1;
    }
  }

  recordError(guildId: string | undefined, message: string): void {
    const iso = new Date().toISOString();
    this.globalCounters.lastErrorAt = iso;
    this.globalCounters.lastErrorMessage = message;
    if (guildId) {
      const g = this.getOrCreateGuildCounters(guildId);
      g.lastErrorAt = iso;
      g.lastErrorMessage = message;
    }
  }

  getGuildCounters(guildId: string): ActionCountersSnapshot {
    return { ...this.getOrCreateGuildCounters(guildId) };
  }

  getThroughputPerSec(nowMs = Date.now()): number {
    const cutoff = nowMs - 10_000;
    while (this.eventHead < this.eventTimestamps.length && this.eventTimestamps[this.eventHead] < cutoff) {
      this.eventHead += 1;
    }
    const active = this.eventTimestamps.length - this.eventHead;
    return Number((active / 10).toFixed(2));
  }

  sampleCpuPercent(): number {
    const nowMs = Date.now();
    const elapsedMs = nowMs - this.lastCpuSampleMs;
    if (elapsedMs >= 500) {
      const diff = process.cpuUsage(this.lastCpuUsage);
      const totalCpuMs = (diff.user + diff.system) / 1000;
      this.lastCpuPercent = Number(Math.min(100, Math.max(0, (totalCpuMs / elapsedMs) * 100)).toFixed(1));
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuSampleMs = nowMs;
    }
    return this.lastCpuPercent;
  }

  getEventLoopLagMs(): number {
    if (!this.loopMonitor) return 0;
    const meanNs = Number(this.loopMonitor.mean || 0);
    return Number((meanNs / 1_000_000).toFixed(2));
  }

  getSnapshot(): RuntimeTelemetrySnapshot {
    return {
      antiRaidEvalLatency: this.evalLatency.getPercentiles(),
      sanctionExecLatency: this.sanctionLatency.getPercentiles(),
      cpuPercent: this.sampleCpuPercent(),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      eventLoopLagMs: this.getEventLoopLagMs(),
      eventThroughputPerSec: this.getThroughputPerSec(),
      counters: { ...this.globalCounters },
    };
  }
}

const globalForTelemetry = globalThis as unknown as {
  __aegisTelemetry?: AegisTelemetryRegistry;
};
export const aegisTelemetry = globalForTelemetry.__aegisTelemetry ?? new AegisTelemetryRegistry();
if (!globalForTelemetry.__aegisTelemetry) {
  globalForTelemetry.__aegisTelemetry = aegisTelemetry;
}
