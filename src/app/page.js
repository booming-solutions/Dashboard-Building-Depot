import Link from 'next/link';

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/92 backdrop-blur-xl border-b border-navy/5 px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <img src="/logo.png" alt="Booming Solutions" className="h-10 w-10 object-contain" />
          <span className="font-display text-xl font-semibold text-navy tracking-tight">Booming Solutions</span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#services" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">Services</a>
          <a href="#dashboards" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">AI Dashboards</a>
          <a href="#contact" className="text-sm font-medium text-gray-500 hover:text-navy transition-colors">Contact</a>
          <Link href="/login" className="bg-navy text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-navy-light transition-all hover:-translate-y-0.5">
            Inloggen
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="min-h-screen flex items-center pt-24 pb-16 px-6 bg-gradient-to-br from-white via-blue-pale to-gray-50">
      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-4 py-1.5 rounded-full text-xs text-gray-500 font-medium shadow-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            Beschikbaar voor nieuwe projecten
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-navy leading-tight tracking-tight">
            Financieel leiderschap,<br />versterkt met <em className="text-blue italic">AI</em>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed mt-6 max-w-lg">
            Interim CFO-services gecombineerd met intelligente dashboards. Helder inzicht in uw financiën — altijd en overal toegankelijk.
          </p>
          <div className="flex gap-4 mt-8">
            <a href="#contact" className="inline-flex items-center gap-2 bg-gold text-navy-deep px-6 py-3 rounded-xl font-semibold hover:bg-gold-light transition-all hover:-translate-y-0.5 shadow-lg shadow-gold/30">
              Plan een gesprek →
            </a>
            <a href="#dashboards" className="inline-flex items-center gap-2 bg-white text-navy px-6 py-3 rounded-xl font-semibold border-2 border-gray-200 hover:border-navy transition-all hover:-translate-y-0.5">
              Bekijk dashboards
            </a>
          </div>
        </div>
        <div className="relative">
          <div className="bg-white rounded-2xl p-6 shadow-2xl shadow-navy/10 border border-navy/5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-navy">Financieel overzicht</h3>
              <span className="text-xs bg-blue-pale text-blue px-3 py-1 rounded-full font-medium">Live data</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Omzet', value: '$2.4M', change: '↑ 12.5%', up: true },
                { label: 'EBITDA', value: '$380K', change: '↑ 8.2%', up: true },
                { label: 'Burn rate', value: '$52K', change: '↓ 3.1%', up: false },
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

function Services() {
  const services = [
    {
      icon: '📊',
      title: 'Interim CFO',
      desc: 'Ervaren financieel leiderschap voor uw organisatie. Van cashflow management tot strategische planning en boardroom presentaties.',
      color: 'bg-navy text-gold',
    },
    {
      icon: '🤖',
      title: 'AI Dashboards',
      desc: 'Real-time financiële dashboards, aangedreven door AI. Automatische inzichten, voorspellingen en rapportages.',
      color: 'bg-blue text-white',
    },
    {
      icon: '✓',
      title: 'Financiële analyse',
      desc: 'Diepgaande analyses van uw financiële positie. KPI-tracking, benchmarking en scenario-planning.',
      color: 'bg-gold text-navy',
    },
  ];

  return (
    <section id="services" className="py-24 px-6 bg-white">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-blue font-semibold mb-3">Onze expertise</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-navy tracking-tight mb-4">Wat Booming Solutions biedt</h2>
        <p className="text-base text-gray-500 leading-relaxed max-w-xl mb-12">
          Van strategisch financieel advies tot real-time AI-dashboards — wij zorgen voor helder inzicht en slimme beslissingen.
        </p>
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

function DashboardSection() {
  const features = [
    { title: 'Live financiële dashboards', desc: 'Omzet, kosten, cashflow en EBITDA in real-time. Aangepast aan uw specifieke KPI\'s.' },
    { title: 'AI-gestuurde inzichten', desc: 'Automatische signalering van trends, afwijkingen en besparingsmogelijkheden.' },
    { title: 'Rapportages en documenten', desc: 'Veilig bestanden delen. Board decks, maandrapportages en analyses altijd beschikbaar.' },
    { title: 'Mobiele app (PWA)', desc: 'Installeer de app op uw telefoon. Bekijk uw dashboards onderweg, zonder App Store.' },
  ];

  return (
    <section id="dashboards" className="py-24 px-6 bg-navy-deep text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(46,139,192,0.15),transparent_60%)]" />
      <div className="max-w-5xl mx-auto relative z-10">
        <p className="text-xs uppercase tracking-widest text-gold font-semibold mb-3">Klantenportaal</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-white tracking-tight mb-4">Uw financiën, altijd bij de hand</h2>
        <p className="text-base text-white/55 leading-relaxed max-w-xl mb-10">
          Log in op het Booming platform en bekijk uw persoonlijke dashboards, rapportages en gedeelde documenten.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {features.map((f) => (
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

function CTA() {
  return (
    <section id="contact" className="py-24 px-6 bg-gray-50 text-center">
      <div className="max-w-xl mx-auto">
        <p className="text-xs uppercase tracking-widest text-blue font-semibold mb-3">Klaar om te starten?</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-navy tracking-tight mb-4">Laten we kennismaken</h2>
        <p className="text-base text-gray-500 leading-relaxed mb-8">
          Benieuwd wat Booming Solutions voor uw organisatie kan betekenen? Plan een vrijblijvend gesprek.
        </p>
        <a href="mailto:info@boomingsolutions.ai" className="inline-flex items-center gap-2 bg-gold text-navy-deep px-8 py-3.5 rounded-xl font-semibold text-lg hover:bg-gold-light transition-all hover:-translate-y-0.5 shadow-lg shadow-gold/30">
          Neem contact op →
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-8 px-6 bg-navy-deep text-white/40 text-center text-sm">
      <p>© 2026 Booming Solutions · Curaçao · <a href="#" className="text-gold hover:underline">Privacy</a> · <a href="#" className="text-gold hover:underline">Voorwaarden</a></p>
    </footer>
  );
}

export default function Home() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Services />
      <DashboardSection />
      <CTA />
      <Footer />
    </main>
  );
}
