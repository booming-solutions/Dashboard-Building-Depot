'use client';

export default function ReportsPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-navy mb-2">Rapportages</h1>
      <p className="text-sm text-gray-400 mb-8">Bekijk en download uw financiële rapportages</p>

      <div className="space-y-3">
        {[
          { name: 'Maandrapportage Maart 2026', date: '20 mrt 2026', type: 'PDF' },
          { name: 'Kwartaalrapport Q1 2026', date: '15 mrt 2026', type: 'PDF' },
          { name: 'Cashflow Forecast Q2', date: '10 mrt 2026', type: 'XLSX' },
          { name: 'Budget vs Actuals 2026', date: '1 mrt 2026', type: 'PDF' },
        ].map((report, i) => (
          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 flex items-center justify-between hover:shadow-md transition-all">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${
                report.type === 'PDF' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'
              }`}>
                {report.type}
              </div>
              <div>
                <h3 className="text-sm font-medium text-navy">{report.name}</h3>
                <p className="text-xs text-gray-400">{report.date}</p>
              </div>
            </div>
            <button className="text-sm text-blue font-medium hover:underline">Download</button>
          </div>
        ))}
      </div>
    </div>
  );
}
