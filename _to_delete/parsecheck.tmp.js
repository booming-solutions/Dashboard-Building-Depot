const fs = require('fs');
const path = require('path');
const swc = require('next/dist/build/swc');

const files = [
  'src/lib/useLang.js',
  'src/lib/translations.js',
  'src/components/SiteNav.js',
  'src/components/SiteFooter.js',
  'src/app/page.js',
  'src/app/red-cube/page.js',
  'src/app/red-cube/RedCubeClient.js',
  'src/app/training/page.js',
  'src/app/training/TrainingClient.js',
  'src/app/api/contact/route.js',
  'src/app/sitemap.js',
  'src/app/robots.js',
];

(async () => {
  let bad = 0;
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    try {
      await swc.transform(code, {
        filename: path.basename(f),
        jsc: {
          parser: { syntax: 'ecmascript', jsx: true },
          target: 'es2020',
          transform: { react: { runtime: 'automatic' } },
        },
      });
      console.log('OK   ' + f);
    } catch (e) {
      bad++;
      console.log('FOUT ' + f + '\n     ' + String(e.message).split('\n').slice(0, 6).join('\n     '));
    }
  }
  console.log(bad === 0 ? '\nAlle bestanden parsen goed.' : `\n${bad} bestand(en) met fouten.`);
})();
