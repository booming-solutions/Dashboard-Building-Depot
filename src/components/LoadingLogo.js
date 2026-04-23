/* ============================================================
   BESTAND: LoadingLogo.js
   KOPIEER NAAR: src/components/LoadingLogo.js
   ============================================================ */
'use client';

export default function LoadingLogo({ text }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
      <style>{`
        @keyframes logoPulse { 0%, 100% { opacity: 1; filter: brightness(1); } 50% { opacity: 0.3; filter: brightness(2); } }
        @keyframes barGrow { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
      `}</style>
      <img src="/logo.png" alt="Loading" className="h-16 w-16 rounded-xl" style={{ animation: 'logoPulse 2s ease-in-out infinite' }} />
      <div className="w-48 h-1.5 bg-[#e5ddd4] rounded-full overflow-hidden">
        <div className="h-full bg-[#E84E1B] rounded-full" style={{ animation: 'barGrow 2s ease-in-out infinite' }}></div>
      </div>
      {text && <p className="text-[13px] text-[#6b5240]">{text}</p>}
    </div>
  );
}
