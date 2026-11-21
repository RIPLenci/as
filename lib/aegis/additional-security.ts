import type { GuildAdditionalSecurityConfig } from './types';

export interface AdditionalSecurityDecision {
  triggered: boolean;
  rule:
    | 'BAN_MALICIOUS'
    | 'ANTI_ALTS'
    | 'ANTI_BOTS'
    | 'ANTI_EVERYONE'
    | 'ANTI_WEBHOOK_SPAM'
    | 'ANTI_MASS_MUTE'
    | 'ANTI_FLOOD'
    | 'ANTI_SCAM'
    | 'ANTI_INVITES'
    | 'ANTI_LINKS';
  action: 'NONE' | 'KICK' | 'BAN' | 'TIMEOUT' | 'DELETE_AND_TIMEOUT' | 'REVERT_AND_SANCTION';
  reason: string;
  durationMinutes?: number;
}

const SCAM_PATTERNS: RegExp[] = [
  /(?:free\s*nitro|discord[-\s]?gift|steam[-\s]?community|airdrop[-\s]?crypto|claim\s*nitro)/i,
  /https?:\/\/(?:discorcl|dlscord|discrod|discord-app|nitro-discord|steamcornmunity|stearncommunity)\.[a-z0-9.-]+/i,
  /https?:\/\/[^\s]*\.(?:ru|tk|ml|ga|cf)\/(?:nitro|gift|steam|verify)/i,
];

const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[a-zA-Z0-9-]+/i;

const URL_REGEX = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:\/[^\s]*)?/gi;

export function normalizeDomain(input: string): string {
  const cleaned = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  return cleaned.split('/')[0]?.split(':')[0] ?? '';
}

export function extractUrlsAndDomains(content: string): string[] {
  const domains: string[] = [];
  const regex = new RegExp(URL_REGEX.source, 'gi');
  let match: RegExpExecArray | null = regex.exec(content);
  while (match !== null) {
    const dom = normalizeDomain(match[1] ?? '');
    if (dom) domains.push(dom);
    match = regex.exec(content);
  }
  return domains;
}

export function evaluateAntiAlt(
  config: GuildAdditionalSecurityConfig,
  accountCreatedAtMs: number,
  nowMs = Date.now()
): AdditionalSecurityDecision {
  if (!config.antiAlts.enabled) {
    return { triggered: false, rule: 'ANTI_ALTS', action: 'NONE', reason: 'Disabled' };
  }
  const ageDays = Math.max(0, (nowMs - accountCreatedAtMs) / 86_400_000);
  if (ageDays < config.antiAlts.minAccountAgeDays) {
    return {
      triggered: true,
      rule: 'ANTI_ALTS',
      action: 'KICK',
      reason: `Account age ${ageDays.toFixed(1)}d < minimum ${config.antiAlts.minAccountAgeDays}d`,
    };
  }
  return { triggered: false, rule: 'ANTI_ALTS', action: 'NONE', reason: 'Account age OK' };
}

export function evaluateAntiBot(
  config: GuildAdditionalSecurityConfig,
  opts: { isBot: boolean; isVerifiedBot: boolean; isWhitelisted: boolean }
): AdditionalSecurityDecision {
  if (!opts.isBot || opts.isWhitelisted || config.antiBots === 'DISABLED') {
    return { triggered: false, rule: 'ANTI_BOTS', action: 'NONE', reason: 'Allowed' };
  }
  if (config.antiBots === 'BAN_ALL') {
    return {
      triggered: true,
      rule: 'ANTI_BOTS',
      action: 'BAN',
      reason: 'Anti Bots (BAN_ALL): unauthorized bot blocked',
    };
  }
  if (config.antiBots === 'UNVERIFIED_ONLY' && !opts.isVerifiedBot) {
    return {
      triggered: true,
      rule: 'ANTI_BOTS',
      action: 'BAN',
      reason: 'Anti Bots (UNVERIFIED_ONLY): unverified bot blocked',
    };
  }
  return { triggered: false, rule: 'ANTI_BOTS', action: 'NONE', reason: 'Verified bot allowed' };
}

export function evaluateAntiEveryoneUpdate(
  config: GuildAdditionalSecurityConfig,
  opts: { isEveryoneRole: boolean; addedDangerousPermissions: string[] }
): AdditionalSecurityDecision {
  if (!config.antiEveryonePerms || !opts.isEveryoneRole || opts.addedDangerousPermissions.length === 0) {
    return { triggered: false, rule: 'ANTI_EVERYONE', action: 'NONE', reason: 'No escalation' };
  }
  return {
    triggered: true,
    rule: 'ANTI_EVERYONE',
    action: 'REVERT_AND_SANCTION',
    reason: `Blocked @everyone privilege escalation: ${opts.addedDangerousPermissions.join(', ')}`,
  };
}

export function evaluateAntiScamMessage(
  config: GuildAdditionalSecurityConfig,
  content: string
): AdditionalSecurityDecision {
  if (!config.antiScam.enabled || content.length < 4) {
    return { triggered: false, rule: 'ANTI_SCAM', action: 'NONE', reason: 'Clean' };
  }
  const matched = SCAM_PATTERNS.some((rx) => rx.test(content));
  if (matched) {
    return {
      triggered: true,
      rule: 'ANTI_SCAM',
      action: 'DELETE_AND_TIMEOUT',
      durationMinutes: config.antiScam.muteMinutes,
      reason: 'Phishing / scam lure detected',
    };
  }
  return { triggered: false, rule: 'ANTI_SCAM', action: 'NONE', reason: 'Clean' };
}

export function evaluateAntiInviteMessage(
  config: GuildAdditionalSecurityConfig,
  content: string,
  channelWhitelisted: boolean
): AdditionalSecurityDecision {
  if (!config.antiInvites || channelWhitelisted || content.length < 6) {
    return { triggered: false, rule: 'ANTI_INVITES', action: 'NONE', reason: 'Allowed' };
  }
  if (!content.includes('.') || (!content.includes('discord') && !content.includes('dsc'))) {
    return { triggered: false, rule: 'ANTI_INVITES', action: 'NONE', reason: 'Clean' };
  }
  if (INVITE_REGEX.test(content)) {
    return {
      triggered: true,
      rule: 'ANTI_INVITES',
      action: 'DELETE_AND_TIMEOUT',
      durationMinutes: 5,
      reason: 'Unauthorized Discord invite link blocked',
    };
  }
  return { triggered: false, rule: 'ANTI_INVITES', action: 'NONE', reason: 'Clean' };
}

export function evaluateAntiLinkMessage(
  config: GuildAdditionalSecurityConfig,
  content: string,
  channelWhitelisted: boolean
): AdditionalSecurityDecision {
  if (!config.antiLinks.enabled || channelWhitelisted || content.length < 10) {
    return { triggered: false, rule: 'ANTI_LINKS', action: 'NONE', reason: 'Allowed' };
  }
  if (!content.includes('http://') && !content.includes('https://')) {
    return { triggered: false, rule: 'ANTI_LINKS', action: 'NONE', reason: 'No URLs' };
  }
  const domains = extractUrlsAndDomains(content);
  if (domains.length === 0) {
    return { triggered: false, rule: 'ANTI_LINKS', action: 'NONE', reason: 'No URLs' };
  }
  const allowedSet = new Set(config.antiLinks.allowedDomains.map(normalizeDomain).filter(Boolean));
  const blocked = domains.find((d) => {
    for (const allowed of allowedSet) {
      if (d === allowed || d.endsWith(`.${allowed}`)) return false;
    }
    return true;
  });
  if (blocked) {
    return {
      triggered: true,
      rule: 'ANTI_LINKS',
      action: 'DELETE_AND_TIMEOUT',
      durationMinutes: 5,
      reason: `External link domain blocked: ${blocked}`,
    };
  }
  return { triggered: false, rule: 'ANTI_LINKS', action: 'NONE', reason: 'Whitelisted domain' };
}

export function evaluateAntiFloodBurst(
  config: GuildAdditionalSecurityConfig,
  opts: { countInWindow: number; channelWhitelisted: boolean }
): AdditionalSecurityDecision {
  if (!config.antiFlood.enabled || opts.channelWhitelisted) {
    return { triggered: false, rule: 'ANTI_FLOOD', action: 'NONE', reason: 'Bypassed' };
  }
  if (opts.countInWindow >= config.antiFlood.maxMessages) {
    return {
      triggered: true,
      rule: 'ANTI_FLOOD',
      action: 'DELETE_AND_TIMEOUT',
      durationMinutes: config.antiFlood.muteMinutes,
      reason: `Message flood detected (${opts.countInWindow} msgs in ${config.antiFlood.windowSeconds}s)`,
    };
  }
  return { triggered: false, rule: 'ANTI_FLOOD', action: 'NONE', reason: 'Below threshold' };
}

export function countActiveAutoModRules(config: GuildAdditionalSecurityConfig): number {
  return [
    config.antiFlood.enabled,
    config.antiScam.enabled,
    config.antiInvites,
    config.antiLinks.enabled,
    config.antiWebhookSpam,
    config.antiEveryonePerms,
  ].filter(Boolean).length;
}
