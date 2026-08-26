'use client';

import Link from 'next/link';

/**
 * Footer voor alle publieke pagina's.
 *
 * Hier staat ook de enige link naar /training. Die pagina hoort niet in het
 * hoofdmenu, maar moet wel gewoon vindbaar zijn voor wie ernaar zoekt.
 */
export default function SiteFooter({ t }) {
  return (
    <footer className="py-8 px-6 bg-navy-deep text-white/40 text-center text-sm">
      <div className="max-w-4xl mx-auto flex flex-col gap-3">
        <p>{t.footer.rights}</p>
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a
            href="https://www.redcube.kitchen"
            className="text-gold hover:underline"
            target="_blank"
            rel="noopener"
          >
            {t.footer.redcube}
          </a>
          <span aria-hidden="true">·</span>
          <Link href="/training" className="text-gold hover:underline">
            {t.footer.training}
          </Link>
          <span aria-hidden="true">·</span>
          <a href="#" className="text-gold hover:underline">{t.footer.privacy}</a>
          <span aria-hidden="true">·</span>
          <a href="#" className="text-gold hover:underline">{t.footer.terms}</a>
        </p>
      </div>
    </footer>
  );
}
