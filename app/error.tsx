'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

const RETRY_KEY = 'aegis_chunk_reload_attempted';

function isChunkError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return (
    msg.includes('ChunkLoadError') ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module')
  );
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const chunkFailure = isChunkError(error);

  useEffect(() => {
    if (!chunkFailure || typeof window === 'undefined') return;
    try {
      const alreadyRetried = window.sessionStorage.getItem(RETRY_KEY);
      if (!alreadyRetried) {
        window.sessionStorage.setItem(RETRY_KEY, '1');
        window.location.reload();
      }
    } catch {
      // Ignore sessionStorage restrictions
    }
  }, [chunkFailure]);

  const handleRetry = () => {
    setRetrying(true);
    if (chunkFailure && typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(RETRY_KEY);
      } catch {
        // ignore
      }
      window.location.reload();
      return;
    }
    reset();
    setRetrying(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#07090F] text-slate-100 px-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-[#0B0F19]/90 p-7 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold text-white">
          {chunkFailure ? 'Actualizando recursos de la aplicación' : 'Se produjo un error inesperado'}
        </h2>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          {chunkFailure
            ? 'Un módulo tardó más de lo esperado en cargarse o cambió tras una actualización. Recarga para continuar.'
            : 'No pudimos renderizar esta vista correctamente. Puedes reintentar de forma segura.'}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
          Reintentar carga
        </button>
      </div>
    </div>
  );
}
