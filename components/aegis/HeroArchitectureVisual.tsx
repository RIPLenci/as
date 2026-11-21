'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { motion } from 'motion/react';
import {
  Activity,
  Network,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import type { LanguageCode, SystemHealthSnapshot } from '@/lib/aegis/types';
import { DiscordBrandMark } from './BrandLogo';

interface HeroArchitectureVisualProps {
  language: LanguageCode;
  systemHealth: SystemHealthSnapshot | null;
  oauthConfigured: boolean;
  apiLatencyMs: number | null;
}

type NodeId = 'ping' | 'servers' | 'users' | 'antinuke' | 'fast' | 'network';

export function HeroArchitectureVisual({
  language,
  systemHealth,
  oauthConfigured,
  apiLatencyMs,
}: HeroArchitectureVisualProps) {
  const isEs = language === 'es';
  const [activeNode, setActiveNode] = useState<NodeId>('antinuke');

  const botIdentity = systemHealth?.botIdentity;
  const botOnline = systemHealth?.bot === 'ONLINE';
  const pingMs = botIdentity?.pingMs ?? null;
  const guildCount = botIdentity?.guildCount ?? null;
  const userCount = botIdentity?.userCount ?? null;
  const botAvatarUrl = botIdentity?.avatarUrl ?? null;
  const botTag = botIdentity?.tag ?? null;
  const l1HitRate = systemHealth?.l1CacheStats?.hitRatePercent ?? 0;

  const pingDisplay =
    pingMs !== null
      ? `${pingMs} ms`
      : apiLatencyMs !== null
        ? `${apiLatencyMs} ms`
        : isEs
          ? 'Mid...'
          : '-- ms';

  const serversDisplay =
    guildCount !== null
      ? `${guildCount.toLocaleString()} ${isEs ? 'activos' : 'active'}`
      : isEs
        ? 'Sin datos'
        : 'Unavailable';

  const usersDisplay =
    userCount !== null
      ? `${userCount.toLocaleString()} ${isEs ? 'usuarios' : 'users'}`
      : isEs
        ? 'Sin datos'
        : 'Unavailable';

  const orbitNodes: Array<{
    id: NodeId;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    sub: string;
    detail: string;
    statusText: string;
    pos: string;
    delay: number;
    lineStart: { x: number; y: number };
  }> = [
    {
      id: 'ping',
      icon: Activity,
      label: isEs ? 'Ping del Bot' : 'Bot Ping',
      sub: pingDisplay,
      detail: isEs
        ? 'Latencia real medida directamente contra la API / Gateway de Discord.'
        : 'Real-time latency measured directly against Discord REST / Gateway.',
      statusText:
        pingMs !== null
          ? `Discord Ping: ${pingMs} ms`
          : apiLatencyMs !== null
            ? `API RTT: ${apiLatencyMs} ms`
            : isEs
              ? 'Ping: Pendiente'
              : 'Ping: Pending',
      pos: 'top-3 left-2 sm:left-5',
      delay: 0.05,
      lineStart: { x: 108, y: 74 },
    },
    {
      id: 'servers',
      icon: Server,
      label: isEs ? 'Servidores' : 'Servers',
      sub: serversDisplay,
      detail: isEs
        ? 'Cantidad real de servidores de Discord protegidos y visibles por el bot.'
        : 'Actual number of Discord servers currently visible and protected by the bot.',
      statusText:
        guildCount !== null
          ? `${guildCount.toLocaleString()} ${isEs ? 'servidores visibles' : 'visible servers'}`
          : isEs
            ? 'Servidores: Sin conexión'
            : 'Servers: Offline',
      pos: 'top-3 right-2 sm:right-5',
      delay: 0.1,
      lineStart: { x: 372, y: 74 },
    },
    {
      id: 'users',
      icon: Users,
      label: isEs ? 'Usuarios' : 'Users',
      sub: usersDisplay,
      detail: isEs
        ? 'Total real de miembros supervisados en los servidores donde el bot está activo.'
        : 'Live member reach monitored across all active Discord guilds.',
      statusText:
        userCount !== null
          ? `${userCount.toLocaleString()} ${isEs ? 'usuarios totales' : 'total users'}`
          : isEs
            ? 'Usuarios: Sin conexión'
            : 'Users: Offline',
      pos: 'top-1/2 -translate-y-1/2 left-0 sm:-left-1',
      delay: 0.15,
      lineStart: { x: 76, y: 190 },
    },
    {
      id: 'antinuke',
      icon: ShieldCheck,
      label: isEs ? 'Sistema Anti-Nuke' : 'Anti-Nuke System',
      sub: botOnline ? 'ON' : (systemHealth?.bot ?? 'OFFLINE'),
      detail: isEs
        ? 'Vigilancia activa del Registro de Auditoría contra borrado masivo y escalado de permisos.'
        : 'Active GuildAuditLog defense blocking mass deletions and permission escalations.',
      statusText: botOnline
        ? isEs
          ? 'Sistema Anti-Nuke: ON'
          : 'Anti-Nuke System: ON'
        : `Anti-Nuke: ${systemHealth?.bot ?? 'OFFLINE'}`,
      pos: 'top-1/2 -translate-y-1/2 right-0 sm:-right-1',
      delay: 0.2,
      lineStart: { x: 404, y: 190 },
    },
    {
      id: 'fast',
      icon: Zap,
      label: isEs ? 'Rápido y Eficaz' : 'Fast & Effective',
      sub:
        apiLatencyMs !== null
          ? `${apiLatencyMs} ms · ${l1HitRate}% L1`
          : `${l1HitRate}% ${isEs ? 'Caché L1' : 'L1 Cache'}`,
      detail: isEs
        ? 'Motor en memoria L1 con ventanas deslizantes de respuesta sub-segundo ante raids.'
        : 'Sub-second L1 memory defense paired with sliding-window burst interception.',
      statusText:
        apiLatencyMs !== null
          ? `RTT ${apiLatencyMs} ms · L1 ${l1HitRate}%`
          : `L1 Cache: ${l1HitRate}% hit rate`,
      pos: 'bottom-16 sm:bottom-14 left-2 sm:left-7',
      delay: 0.25,
      lineStart: { x: 114, y: 292 },
    },
    {
      id: 'network',
      icon: Network,
      label: isEs ? 'Bot en Vivo' : 'Live Bot',
      sub: botOnline
        ? isEs
          ? 'En Línea · OAuth2'
          : 'Online · OAuth2'
        : (systemHealth?.bot ?? 'OFFLINE'),
      detail: isEs
        ? 'Identidad real conectada con autenticación Discord OAuth2 PKCE y respaldo distribuido.'
        : 'Live bot identity synchronized with Discord OAuth2 PKCE & distributed persistence.',
      statusText: `${botOnline ? 'BOT ONLINE' : `BOT ${systemHealth?.bot ?? 'OFFLINE'}`} · OAuth2 ${
        oauthConfigured ? 'ON' : 'PENDING'
      }`,
      pos: 'bottom-16 sm:bottom-14 right-2 sm:right-7',
      delay: 0.3,
      lineStart: { x: 366, y: 292 },
    },
  ];

  const currentDetail = orbitNodes.find((n) => n.id === activeNode) ?? orbitNodes[3];

  return (
    <div
      className="relative w-full max-w-[560px] mx-auto select-none"
      aria-label={
        isEs
          ? 'Telemetría real en vivo del bot AEGIS para Discord'
          : 'AEGIS Discord bot live telemetry architecture'
      }
    >
      <div className="relative w-full aspect-[5/4] flex items-center justify-center">
        {/* Subtle radial glow with continuous slow breath */}
        <motion.div
          animate={{ opacity: [0.55, 0.85, 0.55], scale: [0.97, 1.03, 0.97] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          className="pointer-events-none absolute inset-6 rounded-full bg-radial from-[#5865F2]/28 via-indigo-600/14 to-transparent blur-3xl"
          aria-hidden="true"
        />

        {/* Isometric architectural geometry + animated SVG signal packets */}
        <svg
          viewBox="0 0 480 380"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          <path
            d="M240 42L438 148L240 254L42 148L240 42Z"
            stroke="rgba(99, 102, 241, 0.18)"
            strokeWidth="1"
            fill="rgba(13, 18, 30, 0.42)"
          />
          <path
            d="M240 76L398 160L240 244L82 160L240 76Z"
            stroke="rgba(129, 140, 248, 0.22)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          <circle cx="240" cy="184" r="96" stroke="rgba(99, 102, 241, 0.16)" strokeWidth="1" />
          <circle
            cx="240"
            cy="184"
            r="68"
            stroke="rgba(129, 140, 248, 0.24)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />

          {orbitNodes.map((node, idx) => {
            const isSelected = node.id === activeNode;
            return (
              <g key={node.id}>
                <line
                  x1="240"
                  y1="184"
                  x2={node.lineStart.x}
                  y2={node.lineStart.y}
                  stroke={isSelected ? 'rgba(129, 140, 248, 0.72)' : 'rgba(129, 140, 248, 0.22)'}
                  strokeWidth={isSelected ? '1.6' : '1'}
                  strokeDasharray={isSelected ? undefined : '4 4'}
                />
                <motion.circle
                  r={isSelected ? 3.2 : 2.2}
                  fill={isSelected ? '#A5B4FC' : '#6366F1'}
                  initial={{ cx: 240, cy: 184, opacity: 0 }}
                  animate={{
                    cx: [240, node.lineStart.x],
                    cy: [184, node.lineStart.y],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: 2.2 + idx * 0.25,
                    repeat: Infinity,
                    delay: idx * 0.4,
                    ease: 'easeInOut',
                  }}
                />
              </g>
            );
          })}
        </svg>

        {/* Centerpiece Live Bot Avatar Tile */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ scale: 1.03 }}
          className="relative z-10 -mt-6 flex flex-col items-center gap-3"
        >
          <div className="relative p-1 rounded-[26px] bg-gradient-to-b from-white/25 to-indigo-500/25 shadow-[0_20px_60px_rgba(88,101,242,0.45)]">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-[22px] overflow-hidden bg-gradient-to-br from-[#5865F2] via-[#515BE6] to-[#4338CA] flex items-center justify-center border border-white/20">
              {botAvatarUrl ? (
                <Image
                  src={botAvatarUrl}
                  alt={botTag || 'Discord Bot Avatar'}
                  width={112}
                  height={112}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <DiscordBrandMark className="w-12 h-12 sm:w-14 sm:h-14 text-white drop-shadow-md" />
              )}
            </div>
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              className={`absolute -bottom-2 -right-2 w-9 h-9 rounded-xl bg-[#0B0F1A] border flex items-center justify-center shadow-lg ${
                botOnline ? 'border-emerald-400/50' : 'border-indigo-400/50'
              }`}
            >
              {botOnline ? (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-indigo-400" />
              )}
            </motion.div>
          </div>

          <div className="px-3.5 py-1.5 rounded-lg bg-[#0B0F1A]/92 border border-white/10 text-center backdrop-blur-sm">
            <div className="font-mono text-[11px] font-semibold tracking-wider text-indigo-300">
              {botTag ?? (isEs ? 'BOT DE SEGURIDAD' : 'SECURITY BOT')}
            </div>
            <div className="font-mono text-[10px] text-slate-300 flex items-center justify-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  botOnline ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span>
                {botOnline
                  ? isEs
                    ? 'En Línea · Anti-Nuke ON'
                    : 'Online · Anti-Nuke ON'
                  : isEs
                    ? `Estado: ${systemHealth?.bot ?? 'VERIFICANDO'}`
                    : `Status: ${systemHealth?.bot ?? 'CHECKING'}`}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Interactive Orbital Live Bot Telemetry Nodes */}
        {orbitNodes.map((node) => {
          const Icon = node.icon;
          const isSelected = activeNode === node.id;
          return (
            <motion.button
              key={node.id}
              type="button"
              onClick={() => setActiveNode(node.id)}
              onMouseEnter={() => setActiveNode(node.id)}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.36, delay: node.delay, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.98 }}
              aria-pressed={isSelected}
              aria-label={`${node.label}: ${node.sub}`}
              className={`absolute ${node.pos} z-20 flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left backdrop-blur-md transition-colors cursor-pointer shadow-[0_10px_28px_rgba(0,0,0,0.48)] ${
                isSelected
                  ? 'bg-[#121931]/95 border-[#5865F2]/80'
                  : 'bg-[#0B0F1A]/92 border-white/[0.1] hover:border-indigo-400/50'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-[#5865F2]/25 border-[#5865F2]/50'
                    : 'bg-[#121829] border-white/[0.08]'
                }`}
              >
                <motion.div
                  animate={isSelected ? { scale: [1, 1.12, 1] } : undefined}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Icon className="w-4 h-4 text-indigo-400" />
                </motion.div>
              </div>
              <div className="hidden sm:block leading-tight">
                <div className="text-[11px] font-semibold text-slate-100 whitespace-nowrap">
                  {node.label}
                </div>
                <div className="text-[10px] font-mono text-indigo-300/90 whitespace-nowrap tabular-nums">
                  {node.sub}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Live Selected Telemetry Inspector Strip */}
      <motion.div
        key={currentDetail.id}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="mt-2 p-3.5 rounded-xl bg-[#0B0F1A]/92 border border-white/[0.09] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
      >
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <currentDetail.icon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{currentDetail.label}</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">{currentDetail.detail}</p>
        </div>
        <div className="font-mono text-[11px] text-indigo-300 whitespace-nowrap shrink-0 tabular-nums">
          {currentDetail.statusText}
        </div>
      </motion.div>
    </div>
  );
}
