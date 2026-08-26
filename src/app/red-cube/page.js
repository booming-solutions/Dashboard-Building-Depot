import RedCubeClient from './RedCubeClient';

const SITE = 'https://www.boomingsolutions.ai';
const RED_CUBE = 'https://www.redcube.kitchen';

export const metadata = {
  title: 'Red Cube — keukens op Curaçao en Bonaire | Booming Solutions',
  description:
    'Red Cube is het keukenmerk van Booming Solutions B.V. Britse kwaliteit, uit voorraad op Curaçao en Bonaire. Bekijk het volledige assortiment op redcube.kitchen.',
  alternates: { canonical: `${SITE}/red-cube` },
  openGraph: {
    title: 'Red Cube — keukens op Curaçao en Bonaire',
    description:
      'Het keukenmerk van Booming Solutions B.V. Britse kwaliteit, uit voorraad op het eiland.',
    url: `${SITE}/red-cube`,
    siteName: 'Booming Solutions',
    locale: 'nl_NL',
    type: 'website',
  },
};

/**
 * Structured data. Dit vertelt Google dat "Red Cube" een merk van Booming
 * Solutions is en dat redcube.kitchen dezelfde organisatie is — precies de
 * koppeling die nu ontbreekt tussen de twee sites.
 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Red Cube',
  alternateName: 'Red Cube Kitchens',
  url: RED_CUBE,
  sameAs: [RED_CUBE],
  areaServed: [
    { '@type': 'Country', name: 'Curaçao' },
    { '@type': 'Country', name: 'Bonaire' },
  ],
  parentOrganization: {
    '@type': 'Organization',
    name: 'Booming Solutions B.V.',
    url: SITE,
  },
};

export default function RedCubePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <RedCubeClient />
    </>
  );
}
