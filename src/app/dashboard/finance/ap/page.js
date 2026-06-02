/* ============================================================
   BESTAND: page_v1.js
   KOPIEER NAAR: src/app/dashboard/finance/ap/page.js
   (nieuwe file, hernoemen naar page.js bij upload)

   Nieuwe map "ap" wordt automatisch aangemaakt onder
   src/app/dashboard/finance/

   Eerste placeholder voor de AP-module.
   Volgende stappen: Supabase schema + Openstaande AP lijst.
   ============================================================ */
'use client';

export default function APDashboard() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold text-[#1B3A5C]" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Accounts Payable
        </h1>
        <p className="text-[14px] text-[#1B3A5C]/60 mt-1">
          Crediteurenbeheer — werkstroom van factuur tot betaling
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[#1B3A5C]/10 flex items-center justify-center">
            <span className="text-xl">🚧</span>
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[#1B3A5C]">Module in opbouw</h2>
            <p className="text-[12px] text-[#1B3A5C]/50">Versie 0.1 — placeholder pagina</p>
          </div>
        </div>

        <p className="text-[13px] text-[#1B3A5C]/70 mb-4 leading-relaxed">
          Deze AP-module wordt opgebouwd vanuit een werkende standalone prototype.
          De volgende functionaliteit komt beschikbaar:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { icon: '📊', label: 'Dashboard', desc: 'KPI overzicht openstaande AP' },
            { icon: '📄', label: 'Openstaande AP', desc: 'Compass-export met filters' },
            { icon: '✅', label: 'Werkstroom', desc: 'Selectie → CFO → Batch → Bank' },
            { icon: '🏦', label: 'Bank-bestanden', desc: 'MCB FEP + RBC export' },
            { icon: '🔄', label: 'Afletteren', desc: 'Werklijst voltooide betalingen' },
            { icon: '📋', label: 'Audit log', desc: 'Volledig actie-spoor' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-3 p-3 bg-[#f8fafc] rounded-lg border border-gray-100">
              <span className="text-lg flex-shrink-0">{f.icon}</span>
              <div>
                <p className="text-[13px] font-semibold text-[#1B3A5C]">{f.label}</p>
                <p className="text-[11px] text-[#1B3A5C]/50">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#1B3A5C]/5 rounded-xl border border-[#1B3A5C]/10 p-4">
        <p className="text-[12px] text-[#1B3A5C]/70">
          <strong>Pipeline check:</strong> Als je deze pagina ziet werken GitHub → Vercel deploy
          en de Next.js routing onder <code className="bg-white px-1.5 py-0.5 rounded text-[11px] font-mono">/dashboard/finance/ap</code>.
        </p>
      </div>
    </div>
  );
}
