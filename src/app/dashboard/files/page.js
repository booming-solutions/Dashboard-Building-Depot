'use client';

export default function FilesPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-navy mb-2">Bestanden</h1>
      <p className="text-sm text-gray-400 mb-8">Gedeelde documenten en bestanden</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { name: 'Board Deck Q1', type: 'PPTX', size: '4.2 MB', folder: 'Presentaties' },
          { name: 'Jaarrekening 2025', type: 'PDF', size: '1.8 MB', folder: 'Financieel' },
          { name: 'KPI Template', type: 'XLSX', size: '520 KB', folder: 'Templates' },
          { name: 'Investeerders Memo', type: 'PDF', size: '2.1 MB', folder: 'Strategie' },
          { name: 'Cashflow Model', type: 'XLSX', size: '890 KB', folder: 'Financieel' },
          { name: 'Contracten Overzicht', type: 'PDF', size: '3.4 MB', folder: 'Juridisch' },
        ].map((file, i) => (
          <div key={i} className="bg-white rounded-xl p-5 border border-gray-100 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold mb-3 ${
              file.type === 'PDF' ? 'bg-red-50 text-red-500' :
              file.type === 'XLSX' ? 'bg-green-50 text-green-600' :
              'bg-orange-50 text-orange-500'
            }`}>
              {file.type}
            </div>
            <h3 className="text-sm font-medium text-navy mb-1">{file.name}</h3>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">{file.folder}</span>
              <span className="text-xs text-gray-400">{file.size}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
