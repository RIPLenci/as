import test from 'node:test';
import assert from 'node:assert/strict';
import type { GuildAdditionalSecurityConfig } from './types';
import {
  countActiveAutoModRules,
  evaluateAntiAlt,
  evaluateAntiBot,
  evaluateAntiEveryoneUpdate,
  evaluateAntiFloodBurst,
  evaluateAntiInviteMessage,
  evaluateAntiLinkMessage,
  evaluateAntiScamMessage,
} from './additional-security';

const BASE_CONFIG: GuildAdditionalSecurityConfig = {
  banMaliciousUsers: true,
  antiFlood: { enabled: true, maxMessages: 6, windowSeconds: 5, muteMinutes: 10 },
  antiScam: { enabled: true, muteMinutes: 30, deleteMessage: true },
  antiEveryonePerms: true,
  antiWebhookSpam: true,
  antiMassMute: { enabled: true, maxMutesPerMinute: 3 },
  antiAlts: { enabled: true, minAccountAgeDays: 7 },
  antiBots: 'UNVERIFIED_ONLY',
  antiInvites: true,
  antiLinks: { enabled: true, allowedDomains: ['github.com', 'docs.aegis.gg'] },
};

test('evaluateAntiAlt kicks young accounts and permits older accounts', () => {
  const now = 1_750_000_000_000;
  const twoDaysAgo = now - 2 * 86_400_000;
  const tenDaysAgo = now - 10 * 86_400_000;

  const young = evaluateAntiAlt(BASE_CONFIG, twoDaysAgo, now);
  assert.equal(young.triggered, true);
  assert.equal(young.action, 'KICK');

  const old = evaluateAntiAlt(BASE_CONFIG, tenDaysAgo, now);
  assert.equal(old.triggered, false);
  assert.equal(old.action, 'NONE');
});

test('evaluateAntiBot respects UNVERIFIED_ONLY, BAN_ALL, and whitelist bypass', () => {
  const unverified = evaluateAntiBot(BASE_CONFIG, {
    isBot: true,
    isVerifiedBot: false,
    isWhitelisted: false,
  });
  assert.equal(unverified.triggered, true);
  assert.equal(unverified.action, 'BAN');

  const verified = evaluateAntiBot(BASE_CONFIG, {
    isBot: true,
    isVerifiedBot: true,
    isWhitelisted: false,
  });
  assert.equal(verified.triggered, false);

  const banAll = evaluateAntiBot(
    { ...BASE_CONFIG, antiBots: 'BAN_ALL' },
    { isBot: true, isVerifiedBot: true, isWhitelisted: false }
  );
  assert.equal(banAll.triggered, true);

  const whitelisted = evaluateAntiBot(
    { ...BASE_CONFIG, antiBots: 'BAN_ALL' },
    { isBot: true, isVerifiedBot: false, isWhitelisted: true }
  );
  assert.equal(whitelisted.triggered, false);
});

test('evaluateAntiEveryoneUpdate flags dangerous permission escalation on @everyone', () => {
  const res = evaluateAntiEveryoneUpdate(BASE_CONFIG, {
    isEveryoneRole: true,
    addedDangerousPermissions: ['Administrator', 'ManageRoles'],
  });
  assert.equal(res.triggered, true);
  assert.equal(res.action, 'REVERT_AND_SANCTION');

  const benign = evaluateAntiEveryoneUpdate(BASE_CONFIG, {
    isEveryoneRole: false,
    addedDangerousPermissions: ['Administrator'],
  });
  assert.equal(benign.triggered, false);
});

test('evaluateAntiScamMessage, evaluateAntiInviteMessage, and evaluateAntiLinkMessage catch threats and respect allowlists', () => {
  const scam = evaluateAntiScamMessage(BASE_CONFIG, 'Claim free nitro gift at https://dlscord.gift/nitro');
  assert.equal(scam.triggered, true);
  assert.equal(scam.durationMinutes, 30);

  const invite = evaluateAntiInviteMessage(BASE_CONFIG, 'Join now https://discord.gg/raid123', false);
  assert.equal(invite.triggered, true);
  const inviteWhitelisted = evaluateAntiInviteMessage(BASE_CONFIG, 'Join https://discord.gg/partner', true);
  assert.equal(inviteWhitelisted.triggered, false);

  const allowedLink = evaluateAntiLinkMessage(BASE_CONFIG, 'Check https://sub.github.com/repo', false);
  assert.equal(allowedLink.triggered, false);

  const blockedLink = evaluateAntiLinkMessage(BASE_CONFIG, 'Visit https://unknown-tracker.xyz/promo', false);
  assert.equal(blockedLink.triggered, true);
});

test('evaluateAntiFloodBurst and countActiveAutoModRules compute accurate state', () => {
  const burst = evaluateAntiFloodBurst(BASE_CONFIG, { countInWindow: 6, channelWhitelisted: false });
  assert.equal(burst.triggered, true);
  assert.equal(burst.durationMinutes, 10);

  const bypassed = evaluateAntiFloodBurst(BASE_CONFIG, { countInWindow: 12, channelWhitelisted: true });
  assert.equal(bypassed.triggered, false);

  assert.equal(countActiveAutoModRules(BASE_CONFIG), 6);
});
