'use client';

import { useState } from 'react';
import { translations } from '@/lib/translations';
import { useLang } from '@/lib/useLang';
import SiteNav from '@/components/SiteNav';
import SiteFooter from '@/components/SiteFooter';

/**
 * De stille zijdeur. Geen menu-item, wel een footerlink, wel in de sitemap
 * en gewoon indexeerbaar — zodat wie op "Nederlandse les Curaçao" zoekt
 * hier terechtkomt, en wie voor de dashboards komt er niet over struikelt.
 */
export default function TrainingClient() {
  const [lang, setLang] = useLang();
  const t = translations[lang];
  const p = t.trainingPage;

  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });
  const [status, setStatus] = useState('idle');

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('sending');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, topic: 'training' }),
      });

      if (res.ok) {
        setStatus('success');
        setForm({ name: '', email: '', company: '', message: '' });
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <main>
      <SiteNav t={t} lang={lang} setLang={setLang} />

      <section className="pt-32 pb-16 px-6 bg-gradient-to-br from-white via-blue-pale to-gray-50">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-blue font-semibold mb-4">{p.eyebrow}</p>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-navy leading-tight tracking-tight text-balance">
            {p.title}
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed mt-6">{p.intro}</p>
        </div>
      </section>

      <section className="py-16 px-6 bg-white">
        <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-5">
          <div className="bg-gray-50 rounded-2xl p-7 border border-gray-100">
            <h2 className="font-display text-xl font-semibold text-navy mb-3">{p.business.title}</h2>
            <p className="text-sm text-gray-500 leading-relaxed">{p.business.desc}</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-7 border border-gray-100">
            <h2 className="font-display text-xl font-semibold text-navy mb-3">{p.private.title}</h2>
            <p className="text-sm text-gray-500 leading-relaxed">{p.private.desc}</p>
          </div>
        </div>
      </section>

      <section className="py-16 px-6 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-display text-2xl font-semibold text-navy tracking-tight mb-8">{p.howTitle}</h2>
          <ol className="space-y-5">
            {p.steps.map((step, i) => (
              <li key={step} className="flex gap-5 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-navy text-gold flex items-center justify-center text-sm font-semibold">
                  {i + 1}
                </span>
                <span className="text-base text-gray-600 leading-relaxed pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-20 px-6 bg-gray-50">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl font-semibold text-navy tracking-tight mb-4">{p.formTitle}</h2>
            <p className="text-base text-gray-500 leading-relaxed">{p.formSubtitle}</p>
          </div>

          {status === 'success' ? (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
              <div className="text-4xl mb-4">✅</div>
              <p className="text-green-700 font-medium">{p.success}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-lg shadow-navy/5 border border-gray-100 space-y-5">
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">{t.contact.name} *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-navy focus:outline-none focus:ring-2 focus:ring-blue/30 focus:border-blue transition-all"
                    placeholder={t.contact.namePh}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">{t.contact.email} *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-navy focus:outline-none focus:ring-2 focus:ring-blue/30 focus:border-blue transition-all"
                    placeholder={t.contact.emailPh}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">{t.contact.company}</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-navy focus:outline-none focus:ring-2 focus:ring-blue/30 focus:border-blue transition-all"
                  placeholder={t.contact.companyPh}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">{t.contact.message} *</label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={5}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-navy focus:outline-none focus:ring-2 focus:ring-blue/30 focus:border-blue transition-all resize-none"
                  placeholder={p.messagePh}
                  required
                />
              </div>

              {status === 'error' && (
                <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 border border-red-100">
                  {t.contact.error}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="w-full bg-gold text-navy-deep py-3.5 rounded-xl font-semibold text-lg hover:bg-gold-light transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-gold/20"
              >
                {status === 'sending' ? t.contact.sending : t.contact.send} {status !== 'sending' && '→'}
              </button>
            </form>
          )}
        </div>
      </section>

      <SiteFooter t={t} />
    </main>
  );
}
