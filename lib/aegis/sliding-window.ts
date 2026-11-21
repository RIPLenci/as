// ==============================================================================
// AEGIS SECURITY — L1 BOUNDED MEMORY CACHE, O(1) SLIDING WINDOWS & ALERT DEDUP
// Zero memory-leak guarantees via strict maxEntries eviction + head-pointer pruning
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
}

export interface BurstDetectionResult {
  countInWindow: number;
  thresholdExceeded: boolean;
  similarUsernameCount: number;
  repetitiveSubjectCount: number;
}

interface WindowBucketState {
  records: SlidingWindowRecord[];
  head: number;
  patternCounts: Map<string, number>;
  subjectCounts: Map<string, number>;
}

const MAX_RECORDS_PER_BUCKET = 5000;

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
 * Uses a head-indexed ring queue + O(1) frequency maps to eliminate array reallocation under floods.
 */
export class SlidingWindowTracker {
  private readonly buckets = new Map<string, WindowBucketState>();

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

    // Enforce bounded capacity of MAX_RECORDS_PER_BUCKET active entries
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

    // Periodic compaction only when consumed prefix is large enough
    if (head >= 128 && head * 2 >= records.length) {
      bucket.records = records.slice(head);
      bucket.head = 0;
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
    const cutoff = nowMs - windowSeconds * 1000;
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        records: [],
        head: 0,
        patternCounts: new Map(),
        subjectCounts: new Map(),
      };
      this.buckets.set(bucketKey, bucket);
    } else {
      this.pruneBucket(bucket, cutoff);
    }

    const normalizedPattern = username ? normalizePatternFast(username) : undefined;

    // Make room if bucket is already at MAX_RECORDS_PER_BUCKET before pushing
    if (bucket.records.length - bucket.head >= MAX_RECORDS_PER_BUCKET) {
      const evicted = bucket.records[bucket.head];
      decrementCount(bucket.subjectCounts, evicted.subjectId);
      if (evicted.usernamePatternKey) {
        decrementCount(bucket.patternCounts, evicted.usernamePatternKey);
      }
      bucket.head += 1;
    }

    bucket.records.push({
      timestamp: nowMs,
      subjectId,
      usernamePatternKey: normalizedPattern,
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

    return {
      countInWindow,
      thresholdExceeded: countInWindow >= threshold,
      similarUsernameCount,
      repetitiveSubjectCount,
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
