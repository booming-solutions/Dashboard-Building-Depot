'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function UrentargetPage() {
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ color: '#6b6960', fontSize: 14 }}>Laden...</div>
      </div>
    );
  }

  return (
    <iframe
      src="/uren-dashboard.html"
      style={{
        width: '100%',
        height: 'calc(100vh - 20px)',
        border: 'none',
        display: 'block',
      }}
      title="Urentarget"
    />
  );
}
