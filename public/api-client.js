// The hosted game uses HttpOnly cookies. The Pages edition uses a tab-scoped
// bearer session, so Safari and browsers blocking third-party cookies can play.
export function applicationBase(pageUrl) {
  return new URL('./', pageUrl).href;
}
export function roomLink(pageUrl, code) {
  const url = new URL(applicationBase(pageUrl));
  if (code) url.searchParams.set('room', code);
  return url.href;
}
export function createApiClient({ clientId, pageUrl, apiOrigin = '', fetchImpl = (...args) => globalThis.fetch(...args), storage } = {}) {
  const page = new URL(pageUrl), baseURL = applicationBase(pageUrl);
  const api = new URL(apiOrigin || page.origin);
  if (api.username || api.password || api.search || api.hash || api.pathname !== '/') throw new Error('Invalid API origin');
  const crossOrigin = api.origin !== page.origin;
  if (crossOrigin && api.protocol !== 'https:') throw new Error('The game server must use HTTPS');
  if (storage === undefined) { try { storage = globalThis.sessionStorage; } catch {} }
  const key = 'duko-session:' + api.origin + ':' + new URL(baseURL).pathname;
  let token = null;
  if (crossOrigin) { try { token = storage?.getItem(key) || null; } catch {} }
  if (token && !/^[A-Za-z0-9_-]{43}$/.test(token)) token = null;
  const remember = value => {
    token = value;
    try { if (value) storage?.setItem(key, value); else storage?.removeItem(key); } catch {}
  };
  return {
    baseURL,
    roomURL: code => roomLink(pageUrl, code),
    async request(path, body) {
      if (!/^\/api\/[a-z0-9/-]+$/.test(path)) throw new Error('Invalid game endpoint');
      const headers = { 'X-Duko-Client': clientId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
      if (crossOrigin && token) headers.Authorization = 'Bearer ' + token;
      const response = await fetchImpl(new URL(path, api.origin).href, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: crossOrigin ? 'omit' : 'same-origin',
        mode: crossOrigin ? 'cors' : 'same-origin', redirect: 'error',
        headers, signal: AbortSignal.timeout(10000), cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (crossOrigin && response.ok && path === '/api/session' && /^[A-Za-z0-9_-]{43}$/.test(data.sessionToken || '')) remember(data.sessionToken);
      if (crossOrigin && (data.code === 'SESSION_EXPIRED' || (response.ok && path === '/api/me' && data.session === null))) remember(null);
      // Keep the credential out of rendered state, notifications and room data.
      delete data.sessionToken;
      return { response, data };
    },
  };
}
