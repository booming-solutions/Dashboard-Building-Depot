import './globals.css';

export const metadata = {
  metadataBase: new URL('https://www.boomingsolutions.ai'),
  title: 'Booming Solutions — CFO Services & AI Dashboards',
  description: 'Interim CFO-services gecombineerd met intelligente AI-dashboards. Helder inzicht in uw financiën.',
  manifest: '/manifest.json',
};

// In Next 14 horen themeColor en viewport in een aparte viewport-export.
// Stonden ze in `metadata`, dan negeert Next ze en waarschuwt bij elke build.
export const viewport = {
  themeColor: '#1B3A5C',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
