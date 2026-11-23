// ==============================================================================
// AEGIS SECURITY — L1 BOUNDED MEMORY CACHE, O(1) SLIDING WINDOWS & BOUNDED QUEUES
// Zero memory-leak guarantees via strict maxEntries/MAX_BUCKETS LRU eviction
// ==============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedMemoryCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxEntries = 2000,
    private readonly defaultTtlMs = 60_000
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh recency in O(1) via Map insertion order
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  invalidate(key: string): boolean {
    return this.store.delete(key);
  }

  invalidateByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  getStats() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRatePercent: total === 0 ? 100 : Number(((this.hits / total) * 100).toFixed(1)),
    };
  }

  private evictOldest(): void {
    const oldestKey = this.store.keys().next().value;
    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
    }
  }
}

export interface SlidingWindowRecord {
  timestamp: number;
  subjectId: string;
  usernamePatternKey?: string;
  interArrivalMs?: number;
}

export interface BurstDetectionResult {
  countInWindow: number;
  thresholdExceeded: boolean;
  similarUsernameCount: number;
  repetitiveSubjectCount: number;
  uniqueSubjectsInWindow: number;
  minInterArrivalMs: number | null;
  avgInterArrivalMs: number | null;
  growthRateRatio: number;
  microBurstCount: number;
  concentrationScore: number;
}

interface WindowBucketState {
  records: SlidingWindowRecord[];
  head: number;
  patternCounts: Map<string, number>;
  subjectCounts: Map<string, number>;
  lastTimestampMs: number | null;
  lastTouchedMs: number;
}

const MAX_RECORDS_PER_BUCKET = 5000;
const DEFAULT_MAX_BUCKETS = 4000;

function decrementCount(map: Map<string, number>, key: string): void {
  const prev = map.get(key);
  if (prev === undefined || prev <= 1) {
    map.delete(key);
  } else {
    map.set(key, prev - 1);
  }
}

function normalizePatternFast(username: string): string {
  let out = '';
  const limit = Math.min(username.length, 24);
  let inDigits = false;
  for (let i = 0; i < limit && out.length < 10; i++) {
    const code = username.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      if (!inDigits) {
        out += '#';
        inDigits = true;
      }
    } else {
      inDigits = false;
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : username[i];
    }
  }
  return out;
}

/**
 * Amortized O(1) deterministic Sliding Window tracker for join bursts & anti-nuke actions.
 * Enforces hard `maxBuckets` LRU + staleness eviction so memory stays strictly bounded.
 */
export class SlidingWindowTracker {
  private readonly buckets = new Map<string, WindowBucketState>();
  private readonly maxBuckets: number;

  constructor(maxBuckets = DEFAULT_MAX_BUCKETS) {
    this.maxBuckets = Math.max(8, maxBuckets);
  }

  private pruneBucket(bucket: WindowBucketState, cutoff: number): void {
    const { records, patternCounts, subjectCounts } = bucket;
    let { head } = bucket;

    while (head < records.length && records[head].timestamp < cutoff) {
      const rec = records[head];
      decrementCount(subjectCounts, rec.subjectId);
      if (rec.usernamePatternKey) {
        decrementCount(patternCounts, rec.usernamePatternKey);
      }
      head += 1;
    }

    const excess = records.length - head - MAX_RECORDS_PER_BUCKET;
    if (excess > 0) {
      const stop = head + excess;
      while (head < stop) {
        const rec = records[head];
        decrementCount(subjectCounts, rec.subjectId);
        if (rec.usernamePatternKey) {
          decrementCount(patternCounts, rec.usernamePatternKey);
        }
        head += 1;
      }
    }

    bucket.head = head;

    if (head >= 128 && head * 2 >= records.length) {
      bucket.records = records.slice(head);
      bucket.head = 0;
    }
  }

  public pruneExpiredBuckets(nowMs = Date.now(), maxIdleMs = 300_000): number {
    const staleThreshold = nowMs - maxIdleMs;
    let removed = 0;
    for (const [key, b] of this.buckets.entries()) {
      if (b.lastTouchedMs < staleThreshold || b.records.length - b.head <= 0) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public getBucketCount(): number {
    return this.buckets.size;
  }

  private evictToCapacity(nowMs: number): void {
    if (this.buckets.size < this.maxBuckets) return;
    this.pruneExpiredBuckets(nowMs);
    if (this.buckets.size < this.maxBuckets) return;

    // Enforce hard upper bound using Map LRU order (oldest-touched bucket evicted first)
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (this.buckets.size < this.maxBuckets) {
        break;
      }
    }
  }

  recordAndAnalyze(
    bucketKey: string,
    subjectId: string,
    windowSeconds: number,
    threshold: number,
    username?: string,
    nowMs = Date.now()
  ): BurstDetectionResult {
    const safeWindowSec = Math.max(1, windowSeconds);
    const cutoff = nowMs - safeWindowSec * 1000;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      this.evictToCapacity(nowMs);
      bucket = {
        records: [],
        head: 0,
        patternCounts: new Map(),
        subjectCounts: new Map(),
        lastTimestampMs: null,
        lastTouchedMs: nowMs,
      };
      this.buckets.set(bucketKey, bucket);
    } else {
      this.pruneBucket(bucket, cutoff);
      bucket.lastTouchedMs = nowMs;
      // Refresh LRU insertion order cleanly
      this.buckets.delete(bucketKey);
      this.buckets.set(bucketKey, bucket);
    }

    const normalizedPattern = username ? normalizePatternFast(username) : undefined;

    if (bucket.records.length - bucket.head >= MAX_RECORDS_PER_BUCKET) {
      const evicted = bucket.records[bucket.head];
      decrementCount(bucket.subjectCounts, evicted.subjectId);
      if (evicted.usernamePatternKey) {
        decrementCount(bucket.patternCounts, evicted.usernamePatternKey);
      }
      bucket.head += 1;
    }

    const interArrivalMs =
      bucket.lastTimestampMs !== null ? Math.max(0, nowMs - bucket.lastTimestampMs) : undefined;
    bucket.lastTimestampMs = nowMs;

    bucket.records.push({
      timestamp: nowMs,
      subjectId,
      usernamePatternKey: normalizedPattern,
      interArrivalMs,
    });
    bucket.subjectCounts.set(subjectId, (bucket.subjectCounts.get(subjectId) ?? 0) + 1);
    if (normalizedPattern) {
      bucket.patternCounts.set(
        normalizedPattern,
        (bucket.patternCounts.get(normalizedPattern) ?? 0) + 1
      );
    }

    const countInWindow = bucket.records.length - bucket.head;
    const similarUsernameCount = normalizedPattern
      ? bucket.patternCounts.get(normalizedPattern) ?? 0
      : 0;
    const repetitiveSubjectCount = Math.max(0, (bucket.subjectCounts.get(subjectId) ?? 1) - 1);
    const uniqueSubjectsInWindow = bucket.subjectCounts.size;

    // Sample bounded tail (up to 64 recent entries) in O(1) for micro-burst & velocity metrics
    const microWindowMs = Math.max(1500, Math.floor((safeWindowSec * 1000) / 3));
    const microCutoff = nowMs - microWindowMs;
    const halfCutoff = nowMs - Math.floor((safeWindowSec * 1000) / 2);

    let microBurstCount = 0;
    let recentHalf = 0;
    let earlierHalf = 0;
    let minInterArrival: number | null = null;
    let interSum = 0;
    let interSamples = 0;

    const scanStart = Math.max(bucket.head, bucket.records.length - 64);
    for (let i = bucket.records.length - 1; i >= scanStart; i--) {
      const rec = bucket.records[i];
      if (rec.timestamp >= microCutoff) microBurstCount += 1;
      if (rec.timestamp >= halfCutoff) recentHalf += 1;
      else earlierHalf += 1;
      if (rec.interArrivalMs !== undefined) {
        interSum += rec.interArrivalMs;
        interSamples += 1;
        if (minInterArrival === null || rec.interArrivalMs < minInterArrival) {
          minInterArrival = rec.interArrivalMs;
        }
      }
    }

    const scaledFactor = countInWindow > 64 ? countInWindow / (bucket.records.length - scanStart) : 1;
    const estimatedMicroBurst = Math.round(microBurstCount * scaledFactor);
    const avgInterArrivalMs =
      interSamples > 0 ? Math.round(interSum / interSamples) : null;
    const growthRateRatio =
      earlierHalf === 0
        ? recentHalf > 1
          ? Number(recentHalf.toFixed(2))
          : 1
        : Number((recentHalf / earlierHalf).toFixed(2));

    const microShare = countInWindow > 0 ? Math.min(1, estimatedMicroBurst / countInWindow) : 0;
    const fastArrivalBonus =
      avgInterArrivalMs !== null && avgInterArrivalMs <= 800 && countInWindow >= 3 ? 0.35 : 0;
    const concentrationScore =
      countInWindow <= 1 ? 0 : Number(Math.min(1, microShare * 0.65 + fastArrivalBonus).toFixed(2));

    return {
      countInWindow,
      thresholdExceeded: countInWindow >= threshold,
      similarUsernameCount,
      repetitiveSubjectCount,
      uniqueSubjectsInWindow,
      minInterArrivalMs: minInterArrival,
      avgInterArrivalMs,
      growthRateRatio,
      microBurstCount: estimatedMicroBurst,
      concentrationScore,
    };
  }

  getCount(bucketKey: string, windowSeconds: number, nowMs = Date.now()): number {
    const bucket = this.buckets.get(bucketKey);
    if (!bucket) return 0;
    const cutoff = nowMs - windowSeconds * 1000;
    this.pruneBucket(bucket, cutoff);
    const activeCount = bucket.records.length - bucket.head;
    if (activeCount <= 0) {
      this.buckets.delete(bucketKey);
      return 0;
    }
    return activeCount;
  }

  clearBucket(bucketKey: string): void {
    this.buckets.delete(bucketKey);
  }
}

/**
 * Per-guild bounded concurrent task executor with backpressure and isolation.
 * Prevents slow Discord REST / DM / AuditLog calls in one guild from blocking
 * subsequent incoming member evaluations or starving unrelated guilds.
 */
interface GuildQueueLane {
  running: number;
  pending: Array<() => void>;
}

export class BoundedGuildTaskQueue {
  private readonly lanes = new Map<string, GuildQueueLane>();
  private totalRunning = 0;
  private droppedCount = 0;
  private completedCount = 0;

  constructor(
    private readonly maxConcurrentPerGuild = 6,
    private readonly maxPendingPerGuild = 128,
    private readonly maxGlobalConcurrent = 64
  ) {}

  async enqueue<T>(
    guildId: string,
    task: () => Promise<T>
  ): Promise<{ executed: true; value: T } | { executed: false; reason: 'QUEUE_FULL' }> {
    let lane = this.lanes.get(guildId);
    if (!lane) {
      lane = { running: 0, pending: [] };
      this.lanes.set(guildId, lane);
    }

    const canRunImmediately =
      lane.running < this.maxConcurrentPerGuild &&
      this.totalRunning < this.maxGlobalConcurrent;

    if (!canRunImmediately) {
      if (lane.pending.length >= this.maxPendingPerGuild) {
        this.droppedCount += 1;
        return { executed: false, reason: 'QUEUE_FULL' };
      }
      await new Promise<void>((resolve) => {
        lane!.pending.push(resolve);
      });
    }

    lane.running += 1;
    this.totalRunning += 1;
    try {
      const value = await task();
      this.completedCount += 1;
      return { executed: true, value };
    } finally {
      lane.running -= 1;
      this.totalRunning -= 1;
      this.pumpNext(guildId);
    }
  }

  private pumpNext(preferredGuildId: string): void {
    const preferred = this.lanes.get(preferredGuildId);
    if (
      preferred &&
      preferred.pending.length > 0 &&
      preferred.running < this.maxConcurrentPerGuild &&
      this.totalRunning < this.maxGlobalConcurrent
    ) {
      const next = preferred.pending.shift();
      next?.();
      return;
    }

    if (preferred && preferred.running === 0 && preferred.pending.length === 0) {
      this.lanes.delete(preferredGuildId);
    }

    if (this.totalRunning < this.maxGlobalConcurrent) {
      for (const [gid, lane] of this.lanes.entries()) {
        if (lane.pending.length > 0 && lane.running < this.maxConcurrentPerGuild) {
          const next = lane.pending.shift();
          next?.();
          return;
        }
        if (lane.running === 0 && lane.pending.length === 0) {
          this.lanes.delete(gid);
        }
      }
    }
  }

  getStats() {
    let totalPending = 0;
    for (const lane of this.lanes.values()) {
      totalPending += lane.pending.length;
    }
    return {
      activeGuilds: this.lanes.size,
      totalRunning: this.totalRunning,
      totalPending,
      completedCount: this.completedCount,
      droppedCount: this.droppedCount,
    };
  }
}

/**
 * Serializes async execution per key when strict linear ordering is needed.
 */
export class KeyedAsyncMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => next, () => next);
    this.tails.set(key, chained);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === chained) {
        this.tails.delete(key);
      }
    }
  }
}

/**
 * Deduplicates and batches burst alerts so Discord channels and Dashboard notifications
 * never flood when 100+ events happen within seconds.
 */
export class AlertBatchDeduplicator {
  private readonly lastSent = new Map<string, { sentAt: number; suppressedCount: number }>();

  shouldEmit(
    dedupKey: string,
    batchIntervalSeconds: number,
    nowMs = Date.now()
  ): { emit: boolean; groupedCount: number } {
    if (this.lastSent.size > 2000) {
      const staleCutoff = nowMs - 3600_000;
      for (const [k, v] of this.lastSent.entries()) {
        if (v.sentAt < staleCutoff) this.lastSent.delete(k);
      }
    }

    const existing = this.lastSent.get(dedupKey);
    if (!existing) {
      this.lastSent.set(dedupKey, { sentAt: nowMs, suppressedCount: 0 });
      return { emit: true, groupedCount: 1 };
    }

    if (nowMs - existing.sentAt < batchIntervalSeconds * 1000) {
      existing.suppressedCount += 1;
      return { emit: false, groupedCount: existing.suppressedCount + 1 };
    }

    const groupedCount = existing.suppressedCount + 1;
    this.lastSent.set(dedupKey, { sentAt: nowMs, suppressedCount: 0 });
    return { emit: true, groupedCount };
  }
}
