import TrainingClient from './TrainingClient';

const SITE = 'https://www.boomingsolutions.ai';

export const metadata = {
  title: 'Nederlandse taaltraining op Curaçao — voor bedrijven en particulieren',
  description:
    'Nederlands als tweede taal op Curaçao. In-company training voor teams die in het Nederlands moeten kunnen werken, en individuele lessen. Booming Solutions.',
  alternates: { canonical: `${SITE}/training` },
  openGraph: {
    title: 'Nederlandse taaltraining op Curaçao',
    description:
      'Nederlands als tweede taal, in-company of één-op-één. Voor bedrijven en particulieren.',
    url: `${SITE}/training`,
    siteName: 'Booming Solutions',
    locale: 'nl_NL',
    type: 'website',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Nederlandse taaltraining',
  serviceType: 'Nederlands als tweede taal',
  url: `${SITE}/training`,
  areaServed: { '@type': 'Country', name: 'Curaçao' },
  provider: {
    '@type': 'Organization',
    name: 'Booming Solutions B.V.',
    url: SITE,
  },
};

export default function TrainingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TrainingClient />
    </>
  );
}
