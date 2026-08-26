/** @type {import('next').NextConfig} */
const nextConfig = {
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
