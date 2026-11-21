import type { WhitelistRuleScope } from './types';

export interface VerifiedImageFormat {
  ext: '.png' | '.jpg' | '.webp' | '.gif';
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

/**
 * Verifies real image file signatures (magic bytes) rather than trusting client-supplied MIME headers.
 */
export function detectImageFormatFromMagicBytes(bytes: Uint8Array): VerifiedImageFormat | null {
  if (!bytes || bytes.length < 3) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: '.png', mime: 'image/png' };
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { ext: '.gif', mime: 'image/gif' };
  }

  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: '.webp', mime: 'image/webp' };
  }

  return null;
}

/**
 * Validates that a dynamic URL route segment is a safe single filename/token without traversal sequences.
 */
export function isSafeSinglePathSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false;
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\') || segment.includes('\0')) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(segment);
}

/**
 * Deduplicates an array while preserving first-seen order.
 */
export function dedupePreserveOrder<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Merges whitelist rule exclusions idempotently without introducing duplicates.
 */
export function mergeWhitelistExcludedRules(
  existing: readonly WhitelistRuleScope[],
  incoming: readonly WhitelistRuleScope[]
): WhitelistRuleScope[] {
  return dedupePreserveOrder([...existing, ...incoming]);
}

/**
 * Serializes data safely for inline HTML <script> tags, escaping characters that could break out of script context.
 */
export function sanitizeHtmlScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripUnsafeValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(stripUnsafeValue);
  }
  if (val && typeof val === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (!UNSAFE_JSON_KEYS.has(k)) {
        clean[k] = stripUnsafeValue(v);
      }
    }
    return clean;
  }
  return val;
}

/**
 * Recursively strips prototype-pollution keys from parsed JSON record dictionaries.
 */
export function stripUnsafeKeys<T extends Record<string, unknown>>(obj: T): T {
  return stripUnsafeValue(obj) as T;
}
