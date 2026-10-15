// Generate the GitHub Pages entry point from the same shell as the hosted game.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const apiOrigin = 'https://duko-club-belmo.max083522.chatgpt.site';
const shell = readFileSync(new URL('app/shell.ts', root), 'utf8').trim();
let html = JSON.parse(shell.replace(/^export default\s+/, '').replace(/;$/, ''));
html = html.replace('<head>', `<head>\n  <meta name="duko-version" content="0.5.1">\n  <meta name="duko-api-origin" content="${apiOrigin}">\n  <meta name="duko-service-worker" content="./pages-sw.js">\n  <meta name="referrer" content="strict-origin-when-cross-origin">\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${apiOrigin}; font-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'">`);
html = html.replace(/(href|src)="\/(?!\/)([^"]+)"/g, (_, attribute, path) => `${attribute}="${path === 'manifest.webmanifest' ? './' : './public/'}${path}"`);
writeFileSync(new URL('index.html', root), html);
const manifest = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', root), 'utf8'));
Object.assign(manifest, { id: './', start_url: './', scope: './' });
manifest.icons = manifest.icons.map(icon => ({ ...icon, src: './public/' + icon.src.replace(/^\//, '') }));
writeFileSync(new URL('manifest.webmanifest', root), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(new URL('pages-sw.js', root), "self.DUKO_ASSET_DIRECTORY = './public/';\nimportScripts('./public/sw.js');\n");
writeFileSync(new URL('.nojekyll', root), '');
console.log('GitHub Pages entry point ready: ' + fileURLToPath(new URL('index.html', root)));
