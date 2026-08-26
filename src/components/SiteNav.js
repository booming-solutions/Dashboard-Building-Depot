'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function LanguageSwitcher({ lang, setLang }) {
  return (
    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
      <button
        onClick={() => setLang('nl')}
        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
          lang === 'nl' ? 'bg-white text-navy shadow-sm' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        NL
      </button>
      <button
        onClick={() => setLang('en')}
        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
          lang === 'en' ? 'bg-white text-navy shadow-sm' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        EN
      </button>
    </div>
  );
}

/**
 * Navigatie voor alle publieke pagina's.
 *
 * De ankers (#services, #dashboards, #contact) staan alleen op de homepage.
 * Vanaf een andere pagina wordt er daarom '/#services' van, anders klikt
 * iemand op /training op een anker dat daar niet bestaat.
 */
export default function SiteNav({ t, lang, setLang }) {
  const pathname = usePathname();
  const onHome = pathname === '/';
  const anchor = (id) => (onHome ? `#${id}` : `/#${id}`);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/92 backdrop-blur-xl border-b border-navy/5 px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <img src="/logo.png" alt="Booming Solutions" className="h-10 w-10 object-contain" />
          <span className="font-display text-lg sm:text-xl font-semibold text-navy tracking-tight">
            Booming Solutions
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-6">
          <a href={anchor('services')} className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">
            {t.nav.services}
          </a>
          <a href={anchor('dashboards')} className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">
            {t.nav.dashboards}
          </a>
          <Link href="/red-cube" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">
            {t.nav.redcube}
          </Link>
          <a href={anchor('contact')} className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">
            {t.nav.contact}
          </a>
          <LanguageSwitcher lang={lang} setLang={setLang} />
          <Link
            href="/login"
            className="bg-navy text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-navy-light transition-all hover:-translate-y-0.5"
          >
            {t.nav.login}
          </Link>
        </div>

        {/* Mobiel: alleen de twee dingen die er echt toe doen, op dezelfde regelhoogte */}
        <div className="flex md:hidden items-center gap-3">
          <Link href="/red-cube" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">
            {t.nav.redcube}
          </Link>
          <Link
            href="/login"
            className="bg-navy text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-navy-light transition-all"
          >
            {t.nav.login}
          </Link>
        </div>
      </div>
    </nav>
  );
}
