import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="min-h-screen w-full bg-gradient-to-br from-[#D6E8FA] via-[#CBE2F9] to-[#DCECFB] flex items-center justify-center p-4 sm:p-8 lg:p-10">
      <section
        aria-label="Error 404 — Página no encontrada"
        className="relative w-full max-w-[1140px] rounded-[22px] bg-white shadow-[0_24px_65px_rgba(22,68,130,0.18)] border border-white/95 overflow-hidden"
      >
        {/* Soft pastel sweeping wave backdrop inspired by reference */}
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 overflow-hidden"
        >
          <div className="hidden lg:block absolute -top-24 -right-24 h-[380px] w-[420px] rounded-full bg-[#DDEBFB]" />
          <div className="hidden lg:block absolute top-[8%] right-[-6%] h-[92%] w-[46%] rounded-tl-[160px] rounded-bl-[210px] bg-[#DDEBFB]" />
          <div className="hidden lg:block absolute -bottom-24 left-[18%] h-[210px] w-[90%] rounded-tl-[180px] rounded-tr-[140px] bg-[#DDEBFB]" />
          <div className="lg:hidden absolute -bottom-12 -right-12 h-[340px] w-[92%] rounded-tl-[180px] bg-[#DDEBFB]" />
          <div className="hidden md:block absolute bottom-6 left-[24%] h-20 w-44 rounded-full bg-[#E6F1FC]/90" />
        </div>

        {/* Inner Content (z-auto so mix-blend-multiply on the 404 artwork blends into the backdrop waves) */}
        <div className="relative px-6 sm:px-10 lg:px-14 pt-6 sm:pt-8 pb-10 sm:pb-14">
          {/* Minimal Top Header */}
          <header className="flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-[#133A73] hover:opacity-85 transition-opacity"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#18488A] text-white shadow-sm">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <span className="text-sm sm:text-base font-bold tracking-[0.06em] uppercase text-[#133A73]">
                AEGIS SECURITY
              </span>
            </Link>

            <nav aria-label="Navegación principal" className="flex items-center gap-5 sm:gap-8">
              <Link
                href="/"
                className="text-xs sm:text-sm font-medium text-[#6B809D] hover:text-[#18488A] transition-colors whitespace-nowrap"
              >
                Inicio
              </Link>
              <Link
                href="/?section=servers"
                className="text-xs sm:text-sm font-medium text-[#6B809D] hover:text-[#18488A] transition-colors whitespace-nowrap"
              >
                Servidores
              </Link>
              <Link
                href="/?section=protection-overview"
                className="text-xs sm:text-sm font-medium text-[#6B809D] hover:text-[#18488A] transition-colors whitespace-nowrap"
              >
                Protección
              </Link>
              <Link
                href="/?section=premium"
                className="text-xs sm:text-sm font-medium text-[#6B809D] hover:text-[#18488A] transition-colors whitespace-nowrap"
              >
                Premium
              </Link>
            </nav>
          </header>

          {/* Main 2-Column 404 Hero */}
          <div className="mt-8 sm:mt-10 lg:mt-12 grid grid-cols-1 lg:grid-cols-12 items-center gap-8 lg:gap-6">
            <div className="lg:col-span-5 space-y-5 text-center lg:text-left">
              <h1 className="text-[52px] sm:text-[64px] font-extrabold tracking-tight leading-none text-[#1A4E94]">
                Oops!
              </h1>

              <p className="mx-auto lg:mx-0 max-w-[360px] text-sm sm:text-[15px] leading-relaxed text-[#7A8BA3]">
                No encontramos la página que estabas buscando. Es posible que la ruta haya sido
                movida, eliminada o no exista dentro del panel de AEGIS SECURITY.
              </p>

              <div className="pt-2 flex justify-center lg:justify-start">
                <Link
                  href="/"
                  className="inline-flex items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-[#2560B3] to-[#133A73] px-7 py-3 text-sm sm:text-[15px] font-semibold text-white shadow-[0_12px_26px_rgba(23,67,130,0.32)] hover:brightness-110 active:scale-[0.98] transition-all"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 flex items-center justify-center">
              <Image
                src="/images/not-found-404.jpg"
                alt="Ilustración 404 — Ruta no encontrada"
                width={1200}
                height={900}
                priority
                referrerPolicy="no-referrer"
                className="w-full max-w-[540px] h-auto object-contain mix-blend-multiply select-none"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
