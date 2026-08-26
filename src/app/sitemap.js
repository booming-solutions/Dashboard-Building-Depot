const SITE = 'https://www.boomingsolutions.ai';

/**
 * Alleen de publieke pagina's. /dashboard, /login en /admin horen hier niet
 * in — dat is het klantportaal.
 */
export default function sitemap() {
  const now = new Date();

  return [
    { url: SITE, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE}/red-cube`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/training`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
