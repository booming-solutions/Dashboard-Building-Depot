/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bestanden in private/ (beveiligde downloads via /api/private/[file])
  // expliciet meenemen in de serverless-bundle op Vercel. Zonder dit
  // worden alleen bestanden meegenomen die Next zelf kan afleiden.
  experimental: {
    outputFileTracingIncludes: {
      '/api/private/[file]': ['./private/*.html', './private/*.zip'],
    },
  },

  // PWA headers
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
        ],
      },
    ];
  },

  // Mensen typen de merknaam aan elkaar; /red-cube is de echte URL.
  async redirects() {
    return [
      { source: '/redcube', destination: '/red-cube', permanent: true },
      { source: '/redcube/:path*', destination: '/red-cube', permanent: true },
    ];
  },
};

module.exports = nextConfig;
