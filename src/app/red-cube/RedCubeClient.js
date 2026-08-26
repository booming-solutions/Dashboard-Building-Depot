'use client';

import Link from 'next/link';
import { translations } from '@/lib/translations';
import { useLang } from '@/lib/useLang';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';

/**
 * Brugpagina, geen winkel.
 *
 * Bewust kort en zonder assortiment, prijzen of voorraad — die staan op
 * redcube.kitchen en veranderen. Zet je ze op twee plekken, dan lopen ze
 * uit elkaar. Eén scherm, drie punten, één knop.
 */
export default function RedCubeClient() {
  const [lang, setLang] = useLang();
  const t = translations[lang];
  const p = t.redcubePage;

  return (
    <main>
      <SiteNav t={t} lang={lang} setLang={setLang} />

      <section className="min-h-screen flex items-center pt-28 pb-20 px-6 bg-gradient-to-br from-white via-blue-pale to-gray-50">
        <div className="max-w-3xl mx-auto w-full">
          <p className="text-xs uppercase tracking-widest text-gold-dark font-semibold mb-4">
            {p.eyebrow}
          </p>

          <h1 className="font-display text-4xl md:text-5xl font-semibold text-navy leading-tight tracking-tight text-balance">
            {p.title}
          </h1>

          <p className="text-lg text-gray-500 leading-relaxed mt-6">{p.intro}</p>

          <ul className="mt-10 space-y-3">
            {p.points.map((point) => (
              <li key={point} className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-gold mt-2.5 flex-shrink-0" />
                <span className="text-base text-gray-600 leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>

          <div className="mt-12 bg-white rounded-2xl p-8 shadow-lg shadow-navy/5 border border-gray-100">
            <p className="text-base text-gray-500 leading-relaxed mb-6">{p.ctaIntro}</p>
            <a
              href="https://www.redcube.kitchen"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 bg-gold text-navy-deep px-7 py-3.5 rounded-xl font-semibold text-lg hover:bg-gold-light transition-all hover:-translate-y-0.5 shadow-lg shadow-gold/30"
            >
              {p.cta} →
            </a>
          </div>

          <p className="text-sm text-gray-400 leading-relaxed mt-10">{p.note}</p>

          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-navy hover:underline mt-4"
          >
            ← {p.back}
          </Link>
        </div>
      </section>

      <SiteFooter t={t} />
    </main>
  );
}
