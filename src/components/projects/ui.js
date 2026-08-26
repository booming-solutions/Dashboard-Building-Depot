/* ============================================================
   BESTAND: ui.js
   LOCATIE: src/components/projects/ui.js
   Gedeelde bouwstenen voor de projectomgeving (/projects).
   Huisstijl volgt het dashboard: navy #1B3A5C.
   ============================================================ */
'use client';

export const NAVY = '#1B3A5C';

export function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('nl-NL');
}

export function geld(n, c = 'USD') {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return c + ' ' + Number(n).toLocaleString('nl-NL', { maximumFractionDigits: 0 });
}

export function datum(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dagenTot(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const vandaag = new Date();
  vandaag.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  return Math.round((dt - vandaag) / 86400000);
}

export function dagTekst(d) {
  if (d === null || d === undefined) return '—';
  if (d < 0) return Math.abs(d) + ' dagen over';
  if (d === 0) return 'vandaag';
  if (d === 1) return 'morgen';
  return 'over ' + d + ' dagen';
}

// Zelfde logica als de view pm_v_order_planning
export function planStatus(rij) {
  if (rij && rij.planning_status) return rij.planning_status;
  const d = dagenTot(rij && rij.order_by_date);
  if (d === null) return 'op_tijd';
  if (d < 0) return 'te_laat';
  if (d <= 7) return 'kritiek';
  if (d <= 30) return 'let_op';
  return 'op_tijd';
}

const TONES = {
  crit:    'bg-red-50 text-red-700 border-red-100',
  warn:    'bg-amber-50 text-amber-700 border-amber-100',
  watch:   'bg-blue-50 text-blue-700 border-blue-100',
  ok:      'bg-emerald-50 text-emerald-700 border-emerald-100',
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  navy:    'bg-[#1B3A5C]/10 text-[#1B3A5C] border-[#1B3A5C]/15',
};

export const STATUS_TONE = {
  te_laat: 'crit', kritiek: 'warn', let_op: 'watch', op_tijd: 'ok',
  besteld: 'neutral', geannuleerd: 'neutral',
};

export const STATUS_LABEL = {
  te_laat: 'te laat', kritiek: 'kritiek', let_op: 'let op', op_tijd: 'op tijd',
  besteld: 'besteld', geannuleerd: 'geannuleerd',
};

export function Pill({ tone = 'neutral', children }) {
  return (
    <span className={'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ' + (TONES[tone] || TONES.neutral)}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral' }) {
  const kleur = { crit: '#dc2626', warn: '#d97706', watch: '#2563eb', ok: '#059669', neutral: '#9ca3af' }[tone] || '#9ca3af';
  return <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: kleur }} />;
}

export function Kpi({ label, value, sub, tone }) {
  const kleur = { crit: 'text-red-600', warn: 'text-amber-600', navy: 'text-[#1B3A5C]' }[tone] || 'text-[#1B3A5C]';
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className={'text-2xl font-bold leading-tight mt-0.5 ' + kleur}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function Card({ title, hint, right, children, padded = false }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      {(title || right) && (
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          {title && <h3 className="text-sm font-semibold text-[#1B3A5C]">{title}</h3>}
          {hint && <span className="text-xs text-gray-400">{hint}</span>}
          <div className="flex-1" />
          {right}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </div>
  );
}

export function Bar({ pct, tone = 'navy' }) {
  const kleur = { navy: NAVY, warn: '#d97706', crit: '#dc2626' }[tone] || NAVY;
  const w = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[70px]">
      <div className="h-full rounded-full" style={{ width: w + '%', backgroundColor: kleur }} />
    </div>
  );
}

export function Loading({ tekst = 'Laden...' }) {
  return <div className="py-16 text-center text-sm text-gray-400">{tekst}</div>;
}

export function Empty({ titel, hint }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-semibold text-[#1B3A5C]">{titel}</p>
      {hint && <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">{hint}</p>}
    </div>
  );
}

export function Foutmelding({ error }) {
  const mist = error && /relation .* does not exist|pm_/.test(String(error));
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-[13px] text-amber-800">
      <p className="font-semibold">Kon de projectgegevens niet laden.</p>
      <p className="mt-1">{String(error)}</p>
      {mist && <p className="mt-2">Draai eerst de SQL-scripts (pm-datamodel-v1, v1.1 en v1.2) in de Supabase SQL Editor.</p>}
    </div>
  );
}

export const Th = ({ children, right }) => (
  <th className={'px-3 py-2 text-[10px] uppercase tracking-wider text-gray-400 font-semibold bg-gray-50 border-b border-gray-200 whitespace-nowrap ' + (right ? 'text-right' : 'text-left')}>{children}</th>
);

export const Td = ({ children, right, wrap, className = '' }) => (
  <td className={'px-3 py-2.5 border-b border-gray-50 align-middle ' + (right ? 'text-right ' : '') + (wrap ? '' : 'whitespace-nowrap ') + className}>{children}</td>
);
