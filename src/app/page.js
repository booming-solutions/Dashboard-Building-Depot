'use client';

import { useState } from 'react';
import Link from 'next/link';
import { translations } from '@/lib/translations';

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

function Navbar({ t, lang, setLang }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/92 backdrop-blur-xl border-b border-navy/5 px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <img src="/logo.png" alt="Booming Solutions" className="h-10 w-10 object-contain" />
          <span className="font-display text-xl font-semibold text-navy tracking-tight">Booming Solutions</span>
        </Link>
        <div className="hidden md:flex items-center gap-6">
          <a href="#services" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">{t.nav.services}</a>
          <a href="#dashboards" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">{t.nav.dashboards}</a>
          <a href="#contact" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">{t.nav.contact}</a>
          <LanguageSwitcher lang={lang} setLang={setLang} />
          <Link href="/login" className="bg-navy text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-navy-light transition-all hover:-translate-y-0.5">
            {t.nav.login}
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero({ t }) {
  return (
    <section className="min-h-screen flex items-center pt-24 pb-16 px-6 bg-gradient-to-br from-white via-blue-pale to-gray-50">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-4 py-1.5 rounded-full text-xs text-gray-500 font-medium shadow-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            {t.hero.badge}
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-navy leading-tight tracking-tight">
            {t.hero.title1}<br />{t.hero.title2} <em className="text-blue italic">AI</em>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed mt-6 max-w-lg">
            {t.hero.subtitle}
          </p>
          <div className="flex gap-4 mt-8">
            <a href="#contact" className="inline-flex items-center gap-2 bg-gold text-navy-deep px-6 py-3 rounded-xl font-semibold hover:bg-gold-light transition-all hover:-translate-y-0.5 shadow-lg shadow-gold/30">
              {t.hero.cta} →
            </a>
            <a href="#dashboards" className="inline-flex items-center gap-2 bg-white text-navy px-6 py-3 rounded-xl font-semibold border-2 border-gray-200 hover:border-navy transition-all hover:-translate-y-0.5">
              {t.hero.ctaSecondary}
            </a>
          </div>
        </div>
        <div className="relative">
          <div className="bg-white rounded-2xl p-6 shadow-2xl shadow-navy/10 border border-navy/5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-navy">{t.dashboard.title}</h3>
              <span className="text-xs bg-blue-pale text-blue px-3 py-1 rounded-full font-medium">{t.dashboard.live}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: t.dashboard.revenue, value: '$2.4M', change: '↑ 12.5%', up: true },
                { label: 'EBITDA', value: '$380K', change: '↑ 8.2%', up: true },
                { label: t.dashboard.burnRate, value: '$52K', change: '↓ 3.1%', up: false },
              ].map((m) => (
                <div key={m.label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{m.label}</div>
                  <div className="text-xl font-bold text-navy mt-1">{m.value}</div>
                  <div className={`text-xs font-medium mt-0.5 ${m.up ? 'text-green-600' : 'text-red-500'}`}>{m.change}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 h-32 flex items-end justify-center gap-1.5">
              {[40, 55, 35, 65, 50, 80, 70, 90, 60, 75, 95, 85].map((h, i) => (
                <div
                  key={i}
                  className="w-6 rounded-t"
                  style={{
                    height: `${h}%`,
                    background: i % 3 === 2 ? '#F0B429' : i % 2 === 0 ? '#2E8BC0' : '#4BA3D4',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Services({ t }) {
  const services = [
    { icon: '📊', ...t.services.cfo, color: 'bg-navy text-gold' },
    { icon: '🤖', ...t.services.ai, color: 'bg-blue text-white' },
    { icon: '✓', ...t.services.analysis, color: 'bg-gold text-navy' },
  ];

  return (
    <section id="services" className="py-24 px-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-blue font-semibold mb-3">{t.services.label}</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-navy tracking-tight mb-4">{t.services.title}</h2>
        <p className="text-base text-gray-500 leading-relaxed max-w-xl mb-12">{t.services.subtitle}</p>
        <div className="grid md:grid-cols-3 gap-5">
          {services.map((s) => (
            <div key={s.title} className="bg-gray-50 rounded-2xl p-7 border border-gray-100 hover:-translate-y-1 hover:shadow-lg hover:shadow-navy/5 transition-all">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg mb-5 ${s.color}`}>{s.icon}</div>
              <h3 className="font-display text-xl font-semibold text-navy mb-3">{s.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardSection({ t }) {
  return (
    <section id="dashboards" className="py-24 px-6 bg-navy-deep text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(46,139,192,0.15),transparent_60%)]" />
      <div className="max-w-5xl mx-auto relative z-10">
        <p className="text-xs uppercase tracking-widest text-gold font-semibold mb-3">{t.portal.label}</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-white tracking-tight mb-4">{t.portal.title}</h2>
        <p className="text-base text-white/55 leading-relaxed max-w-xl mb-10">{t.portal.subtitle}</p>
        <div className="grid md:grid-cols-2 gap-4">
          {t.portal.features.map((f) => (
            <div key={f.title} className="flex gap-4 items-start bg-white/5 rounded-xl p-5 border border-white/8 hover:bg-white/8 transition-all">
              <span className="w-2.5 h-2.5 rounded-full bg-gold mt-1.5 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-semibold text-white mb-1">{f.title}</h4>
                <p className="text-sm text-white/50 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContactForm({ t }) {
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });
  const [status, setStatus] = useState('idle');

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('sending');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
    <section id="contact" className="py-24 px-6 bg-gray-50">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-blue font-semibold mb-3">{t.contact.label}</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-navy tracking-tight mb-4">{t.contact.title}</h2>
          <p className="text-base text-gray-500 leading-relaxed">{t.contact.subtitle}</p>
        </div>

        {status === 'success' ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-4">✅</div>
            <p className="text-green-700 font-medium">{t.contact.success}</p>
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
                placeholder={t.contact.messagePh}
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
  );
}

function Footer({ t }) {
  return (
    <footer className="py-8 px-6 bg-navy-deep text-white/40 text-center text-sm">
      <p>{t.footer.rights} · <a href="#" className="text-gold hover:underline">{t.footer.privacy}</a> · <a href="#" className="text-gold hover:underline">{t.footer.terms}</a></p>
    </footer>
  );
}

export default function Home() {
  const [lang, setLang] = useState('nl');
  const t = translations[lang];

  return (
    <main>
      <Navbar t={t} lang={lang} setLang={setLang} />
      <Hero t={t} />
      <Services t={t} />
      <DashboardSection t={t} />
      <ContactForm t={t} />
      <Footer t={t} />
    </main>
  );
}
