const SITE = 'https://www.boomingsolutions.ai';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Het klantportaal hoort niet in Google.
        disallow: ['/dashboard', '/dashboard/', '/admin', '/api/', '/login', '/auth/'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
