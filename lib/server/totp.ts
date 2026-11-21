import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecretBase32(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function buildTotpOtpAuthUri(
  secretBase32: string,
  accountLabel: string,
  issuer = 'AEGIS SECURITY'
): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function computeHotpCode(secretBase32: string, counter: number): string {
  const key = decodeBase32(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  token: string,
  nowMs: number = Date.now(),
  windowSteps: number = 1
): boolean {
  const clean = token.trim();
  if (!/^\d{6}$/.test(clean) || !secretBase32) return false;
  const step = Math.floor(nowMs / 1000 / 30);

  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const candidate = computeHotpCode(secretBase32, step + offset);
    if (
      candidate.length === clean.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(clean))
    ) {
      return true;
    }
  }
  return false;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const partA = crypto.randomBytes(2).toString('hex').toUpperCase();
    const partB = crypto.randomBytes(2).toString('hex').toUpperCase();
    codes.push(`${partA}-${partB}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}
