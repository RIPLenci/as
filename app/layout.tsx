import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AEGIS SECURITY | Protección Anti-Raid y Seguridad Avanzada para Discord',
  description:
    'Plataforma de seguridad Anti-Raid para Discord: Motor de Riesgo explicable, defensa Anti-Nuke, Cuarentena, Lockdown y aislamiento estricto por servidor.',
  openGraph: {
    title: 'AEGIS SECURITY | Protección Anti-Raid y Seguridad para Discord',
    description:
      'Plataforma de seguridad Anti-Raid para Discord con Motor de Riesgo explicable, defensa Anti-Nuke y gestión aislada por servidor.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AEGIS SECURITY',
    description: 'Seguridad Anti-Raid y Protección Avanzada para Discord.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`dark ${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="bg-[#F8FAFC] text-slate-900 dark:bg-[#07090F] dark:text-slate-100 antialiased selection:bg-[#5865F2]/30 selection:text-indigo-200"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
