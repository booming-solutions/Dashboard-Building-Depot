'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bs-lang';

/**
 * Taalkeuze die meereist tussen pagina's.
 *
 * De server rendert altijd 'nl', net als voorheen, zodat er geen
 * hydration-mismatch ontstaat. Pas na het mounten wordt een eerder
 * gekozen taal uit localStorage gelezen.
 */
export function useLang() {
  const [lang, setLangState] = useState('nl');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'nl' || stored === 'en') setLangState(stored);
    } catch {
      /* privémodus of storage geblokkeerd: gewoon 'nl' aanhouden */
    }
  }, []);

  function setLang(next) {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* niet kunnen onthouden is geen reden om de wissel te blokkeren */
    }
  }

  return [lang, setLang];
}
