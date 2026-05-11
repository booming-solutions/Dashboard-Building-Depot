/* ============================================================
   BESTAND: supabase-server.js
   KOPIEER NAAR: src/lib/supabase-server.js
   (NIEUW bestand, naast bestaande supabase.js)

   Server-side Supabase client voor gebruik in API routes en
   server components. Leest de auth cookie zodat we de
   ingelogde gebruiker kunnen valideren.
   ============================================================ */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function createServerSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // can be called from a Server Component
          }
        },
        remove(name, options) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // can be called from a Server Component
          }
        },
      },
    }
  );
}
