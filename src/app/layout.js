import './globals.css';

export const metadata = {
  title: 'Booming Solutions — CFO Services & AI Dashboards',
  description: 'Interim CFO-services gecombineerd met intelligente AI-dashboards. Helder inzicht in uw financiën.',
  manifest: '/manifest.json',
  themeColor: '#1B3A5C',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
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
