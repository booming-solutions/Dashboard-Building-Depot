'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';

function MetricCard({ label, value, change, up }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-100 hover:shadow-md transition-all">
      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-2xl font-bold text-navy mt-1">{value}</p>
      <p className={`text-sm font-medium mt-1 ${up ? 'text-green-600' : 'text-red-500'}`}>
        {up ? '↑' : '↓'} {change}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const supabase = createClient();

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    }
    getUser();
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-navy">
          Welkom{user?.email ? `, ${user.email.split('@')[0]}` : ''} 👋
        </h1>
        <p className="text-sm text-gray-400 mt-1">Hier is uw financieel overzicht</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Omzet YTD" value="$2.4M" change="12.5% vs vorig jaar" up={true} />
        <MetricCard label="EBITDA" value="$380K" change="8.2% vs vorig kwartaal" up={true} />
        <MetricCard label="Cashflow" value="$195K" change="23.4% vs vorige maand" up={true} />
        <MetricCard label="Burn rate" value="$52K/mnd" change="3.1% lager" up={false} />
      </div>

      {/* Charts placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <h3 className="text-sm font-semibold text-navy mb-4">Omzet per maand</h3>
          <div className="h-48 flex items-end justify-around gap-2">
            {[45, 52, 38, 65, 58, 72, 68, 85, 62, 78, 92, 88].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-md transition-all hover:opacity-80"
                  style={{
                    height: `${h}%`,
                    background: i === 11 ? '#F0B429' : '#2E8BC0',
                  }}
                />
                <span className="text-[10px] text-gray-400">
                  {['J','F','M','A','M','J','J','A','S','O','N','D'][i]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <h3 className="text-sm font-semibold text-navy mb-4">AI Inzichten</h3>
          <div className="space-y-3">
            {[
              { text: 'Operationele kosten zijn 14% gedaald t.o.v. vorig kwartaal', type: 'positive' },
              { text: 'Debiteuren dagentelling stijgt — actie aanbevolen', type: 'warning' },
              { text: 'Cashflow voorspelling: positief voor de komende 3 maanden', type: 'positive' },
              { text: 'Seizoenspatroon gedetecteerd in omzetdata', type: 'info' },
            ].map((insight, i) => (
              <div key={i} className={`flex gap-3 items-start p-3 rounded-lg ${
                insight.type === 'positive' ? 'bg-green-50' :
                insight.type === 'warning' ? 'bg-amber-50' : 'bg-blue-pale'
              }`}>
                <span className="text-sm mt-0.5">
                  {insight.type === 'positive' ? '✅' : insight.type === 'warning' ? '⚠️' : '💡'}
                </span>
                <p className="text-sm text-gray-600">{insight.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-xl p-6 border border-gray-100">
        <h3 className="text-sm font-semibold text-navy mb-4">Recente activiteit</h3>
        <div className="space-y-3">
          {[
            { action: 'Maandrapportage maart geüpload', time: '2 uur geleden' },
            { action: 'Dashboard KPI\'s bijgewerkt', time: '5 uur geleden' },
            { action: 'Cashflow forecast gegenereerd', time: '1 dag geleden' },
          ].map((item, i) => (
            <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
              <p className="text-sm text-gray-600">{item.action}</p>
              <span className="text-xs text-gray-400">{item.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
