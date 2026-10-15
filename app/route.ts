import html from './shell';
export const dynamic = 'force-dynamic';
export function GET() {
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  }});
}
