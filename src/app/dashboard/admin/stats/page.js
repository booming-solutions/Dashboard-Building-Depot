/* ============================================================
   BESTAND: page_stats.js
   KOPIEER NAAR: src/app/dashboard/admin/stats/page.js
   (maak de map admin/stats aan)
   ============================================================ */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';

var MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
var DAYS = ['Zo','Ma','Di','Wo','Do','Vr','Za'];

function fmt(n) { return (n || 0).toLocaleString('nl-NL'); }

function Pill({ label, active, onClick }) {
  return <button className={'px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ' + (active ? 'bg-[#E84E1B] text-white border-[#E84E1B]' : 'bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]')} onClick={onClick}>{label}</button>;
}

export default function AdminStats() {
  var _d = useState([]), data = _d[0], setData = _d[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _auth = useState(false), isAdmin = _auth[0], setIsAdmin = _auth[1];
  var _period = useState('30d'), period = _period[0], setPeriod = _period[1];

  var supabase = createClient();

  useEffect(function() {
    async function init() {
      // Check admin
      var u = await supabase.auth.getUser();
      if (u.data.user) {
        var pr = await supabase.from('profiles').select('role').eq('id', u.data.user.id).maybeSingle();
        if (pr.data && pr.data.role === 'admin') {
          setIsAdmin(true);
          await loadData();
        }
      }
      setLoading(false);
    }
    init();
  }, []);

  async function loadData() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await supabase.from('page_views').select('*').order('visited_at', { ascending: false }).range(from, from + step - 1);
      if (!r.data || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    setData(all);
  }

  // Filter data by period
  var filtered = useMemo(function() {
    if (!data.length) return [];
    var now = new Date();
    var cutoff = new Date();
    if (period === '7d') cutoff.setDate(now.getDate() - 7);
    else if (period === '30d') cutoff.setDate(now.getDate() - 30);
    else if (period === '90d') cutoff.setDate(now.getDate() - 90);
    else return data; // 'all'
    return data.filter(function(r) { return new Date(r.visited_at) >= cutoff; });
  }, [data, period]);

  // Stats calculations
  var stats = useMemo(function() {
    if (!filtered.length) return null;

    // Unique users
    var users = {};
    filtered.forEach(function(r) {
      var email = r.user_email || 'Anoniem';
      if (!users[email]) users[email] = { email: email, views: 0, pages: {}, lastVisit: r.visited_at, sessions: {} };
      users[email].views++;
      users[email].pages[r.page_path] = (users[email].pages[r.page_path] || 0) + 1;
      if (r.visited_at > users[email].lastVisit) users[email].lastVisit = r.visited_at;
      if (r.session_id) users[email].sessions[r.session_id] = true;
    });

    // Sort users by views
    var userList = Object.values(users).sort(function(a, b) { return b.views - a.views; });

    // Page popularity
    var pages = {};
    filtered.forEach(function(r) {
      var title = r.page_title || r.page_path;
      if (!pages[title]) pages[title] = { title: title, path: r.page_path, views: 0, uniqueUsers: {} };
      pages[title].views++;
      pages[title].uniqueUsers[r.user_email || 'anon'] = true;
    });
    var pageList = Object.values(pages).map(function(p) {
      p.unique = Object.keys(p.uniqueUsers).length;
      return p;
    }).sort(function(a, b) { return b.views - a.views; });

    // Views per day
    var daily = {};
    filtered.forEach(function(r) {
      var day = r.visited_at.split('T')[0];
      if (!daily[day]) daily[day] = 0;
      daily[day]++;
    });
    var dailyList = Object.entries(daily).sort(function(a, b) { return a[0].localeCompare(b[0]); });

    // Views per hour
    var hourly = Array(24).fill(0);
    filtered.forEach(function(r) {
      var h = new Date(r.visited_at).getHours();
      hourly[h]++;
    });

    // Views per weekday
    var weekday = Array(7).fill(0);
    filtered.forEach(function(r) {
      var d = new Date(r.visited_at).getDay();
      weekday[d]++;
    });

    // Total sessions
    var allSessions = {};
    filtered.forEach(function(r) { if (r.session_id) allSessions[r.session_id] = true; });

    return {
      totalViews: filtered.length,
      uniqueUsers: userList.length,
      totalSessions: Object.keys(allSessions).length,
      avgViewsPerSession: Object.keys(allSessions).length ? (filtered.length / Object.keys(allSessions).length).toFixed(1) : 0,
      users: userList,
      pages: pageList,
      daily: dailyList,
      hourly: hourly,
      weekday: weekday,
    };
  }, [filtered]);

  if (loading) return <LoadingLogo text="Statistieken laden..." />;
  if (!isAdmin) return <div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Geen toegang. Admin rechten vereist.</p></div>;
  if (!stats) return <div className="text-center py-16"><p className="text-[#6b5240]">Nog geen paginabezoeken geregistreerd.</p></div>;

  var maxDaily = Math.max.apply(null, stats.daily.map(function(d) { return d[1]; }).concat([1]));
  var maxHourly = Math.max.apply(null, stats.hourly.concat([1]));
  var maxWeekday = Math.max.apply(null, stats.weekday.concat([1]));

  return (
    <div className="max-w-[1400px] mx-auto" style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", color: '#1a0a04' }}>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '22px', fontWeight: 900 }}>Dashboard Statistieken</h1>
          <p className="text-[13px] text-[#6b5240]">Gebruikersactiviteit en paginabezoeken</p>
        </div>
      </div>

      {/* Period filter */}
      <div className="flex gap-2 mb-5">
        <Pill label="7 dagen" active={period === '7d'} onClick={function() { setPeriod('7d'); }} />
        <Pill label="30 dagen" active={period === '30d'} onClick={function() { setPeriod('30d'); }} />
        <Pill label="90 dagen" active={period === '90d'} onClick={function() { setPeriod('90d'); }} />
        <Pill label="Alles" active={period === 'all'} onClick={function() { setPeriod('all'); }} />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Paginabezoeken', value: fmt(stats.totalViews), color: '#E84E1B' },
          { label: 'Unieke Gebruikers', value: fmt(stats.uniqueUsers), color: '#1B3A5C' },
          { label: 'Sessies', value: fmt(stats.totalSessions), color: '#16a34a' },
          { label: 'Gem. pagina\'s/sessie', value: stats.avgViewsPerSession, color: '#d97706' },
        ].map(function(k, i) {
          return (
            <div key={i} className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: k.color }}></div>
              <p className="text-[10px] text-[#6b5240] font-bold uppercase tracking-[1px]">{k.label}</p>
              <p className="text-[26px] font-semibold font-mono mt-1" style={{ color: k.color }}>{k.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Daily views chart */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[14px] font-bold mb-3">Bezoeken per dag</h3>
          <div className="flex items-end gap-[2px] h-[120px]">
            {stats.daily.slice(-30).map(function(d) {
              var h = Math.max(2, (d[1] / maxDaily) * 120);
              var dt = d[0].split('-');
              var label = parseInt(dt[2]) + ' ' + MN[parseInt(dt[1]) - 1];
              return <div key={d[0]} className="flex-1 rounded-t-sm cursor-default" style={{ height: h + 'px', backgroundColor: '#E84E1B', minWidth: '4px' }} title={label + ': ' + d[1] + ' bezoeken'}></div>;
            })}
          </div>
          <div className="flex justify-between text-[9px] text-[#a08a74] mt-1">
            {stats.daily.length > 0 && <span>{(function() { var p = stats.daily[Math.max(0, stats.daily.length - 30)][0].split('-'); return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1]; })()}</span>}
            {stats.daily.length > 0 && <span>{(function() { var p = stats.daily[stats.daily.length - 1][0].split('-'); return parseInt(p[2]) + ' ' + MN[parseInt(p[1]) - 1]; })()}</span>}
          </div>
        </div>

        {/* Hourly distribution */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[14px] font-bold mb-3">Bezoeken per uur</h3>
          <div className="flex items-end gap-[2px] h-[120px]">
            {stats.hourly.map(function(v, i) {
              var h = Math.max(2, (v / maxHourly) * 120);
              return <div key={i} className="flex-1 rounded-t-sm cursor-default" style={{ height: h + 'px', backgroundColor: '#1B3A5C', minWidth: '4px' }} title={i + ':00 — ' + v + ' bezoeken'}></div>;
            })}
          </div>
          <div className="flex justify-between text-[9px] text-[#a08a74] mt-1">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

        {/* Weekday distribution */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[14px] font-bold mb-3">Bezoeken per weekdag</h3>
          <div className="space-y-2">
            {stats.weekday.map(function(v, i) {
              var pct = maxWeekday ? (v / maxWeekday) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-[#6b5240] w-6 font-mono">{DAYS[i]}</span>
                  <div className="flex-1 h-[18px] bg-[#f0ebe5] rounded-sm overflow-hidden">
                    <div className="h-full rounded-sm" style={{ width: pct + '%', backgroundColor: i === 0 || i === 6 ? '#d97706' : '#16a34a' }}></div>
                  </div>
                  <span className="text-[10px] font-mono text-[#6b5240] w-8 text-right">{v}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top pages */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[14px] font-bold mb-3">Populairste pagina's</h3>
          <div className="space-y-2">
            {stats.pages.slice(0, 12).map(function(p, i) {
              var pct = stats.totalViews ? (p.views / stats.totalViews) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[#a08a74] w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate" title={p.title}>{p.title}</div>
                    <div className="h-[6px] bg-[#f0ebe5] rounded-sm overflow-hidden mt-0.5">
                      <div className="h-full rounded-sm bg-[#E84E1B]" style={{ width: pct + '%' }}></div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[11px] font-mono font-semibold">{p.views}</span>
                    <span className="text-[9px] text-[#a08a74] ml-1">{p.unique + 'u'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active users */}
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[14px] font-bold mb-3">Gebruikers</h3>
          <div className="space-y-2">
            {stats.users.map(function(u, i) {
              var sessies = Object.keys(u.sessions).length;
              var lastDt = new Date(u.lastVisit);
              var lastLabel = lastDt.getDate() + ' ' + MN[lastDt.getMonth()] + ' ' + String(lastDt.getHours()).padStart(2, '0') + ':' + String(lastDt.getMinutes()).padStart(2, '0');
              return (
                <div key={i} className="flex items-center gap-2 py-1 border-b border-[#f0ebe5] last:border-0">
                  <div className="w-7 h-7 rounded-full bg-[#1B3A5C] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {u.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold truncate">{u.email}</div>
                    <div className="text-[9px] text-[#a08a74]">{u.views + ' bezoeken · ' + sessies + ' sessies · laatst ' + lastLabel}</div>
                  </div>
                  <div className="text-[13px] font-mono font-bold text-[#E84E1B] flex-shrink-0">{u.views}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-8">
        <h3 className="text-[14px] font-bold mb-3">Recente activiteit</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#f0ebe5]">
                <th className="p-2 text-left text-[9px] text-[#6b5240] font-bold uppercase">Tijdstip</th>
                <th className="p-2 text-left text-[9px] text-[#6b5240] font-bold uppercase">Gebruiker</th>
                <th className="p-2 text-left text-[9px] text-[#6b5240] font-bold uppercase">Pagina</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map(function(r, i) {
                var dt = new Date(r.visited_at);
                var timeStr = dt.getDate() + ' ' + MN[dt.getMonth()] + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') + ':' + String(dt.getSeconds()).padStart(2, '0');
                return (
                  <tr key={r.id || i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fdfcfb]'}>
                    <td className="p-2 font-mono text-[#6b5240]">{timeStr}</td>
                    <td className="p-2">{r.user_email || 'Anoniem'}</td>
                    <td className="p-2">{r.page_title || r.page_path}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
