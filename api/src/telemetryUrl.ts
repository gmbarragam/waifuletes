/**
 * Sanitização de URL para spans (sem dependências; usada pelo instrumentation.ts).
 *
 * Servidor: `url.path` vem de `http.route` (ex.: `/user/:userId`) quando existe; sem rota (404),
 * só o primeiro segmento literal é mantido. Query: só parâmetros da allowlist mantêm o valor.
 *
 * Cliente (fetch para ravena/JDS/Hub/Telegram): `url.full` = origem + caminho com cada segmento
 * que não seja literal conhecido trocado por `{id}`, sem query.
 */

/** Parâmetros de query sem texto livre nem ID de pessoa (paginação, filtros de enum, flags). */
const SAFE_QUERY_PARAMS = new Set([
  'limit',
  'page',
  'offset',
  'sort',
  'sortBy',
  'order',
  'rarity',
  'gender',
  'status',
  'maritalStatus',
  'type',
  'onlySelf',
  'withoutCollection',
  'unreadOnly',
  'refresh',
  'all',
  'format',
  'updatedAfter',
]);

/** Segmentos literais dos caminhos de saída conhecidos (ravena, JDS, Hub, Telegram, LLM). */
const SAFE_CLIENT_SEGMENTS = new Set([
  'api',
  'external',
  'characters',
  'character',
  'pool',
  'market',
  'user-inventory',
  'transfer',
  'inventory',
  'farm',
  'chat',
  'completions',
  'html',
  'file',
  'bot{token}',
  'wiki',
  'media',
  'notify',
  'waifu',
  'user-roll-context',
  'farm-bonus',
  'reserve',
  'refund',
  'notify-legendary-marriage',
]);
const TELEGRAM_METHOD = /^(?:send|edit|delete|get|set|answer|pin|unpin|copy|forward)[A-Z][A-Za-z]{2,40}$/;
const VERSION_SEGMENT = /^v\d{1,2}$/;
const TELEGRAM_BOT_TOKEN = /\/bot\d+:[A-Za-z0-9_-]+/g;

export function sanitizeQuery(query: string): string {
  const q = query.startsWith('?') ? query.slice(1) : query;
  const out: string[] = [];
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const safeKey = /^[A-Za-z0-9_.[\]-]{1,40}$/.test(key) ? key : 'param';
    if (eq === -1) out.push(safeKey);
    else out.push(`${safeKey}=${SAFE_QUERY_PARAMS.has(key) ? part.slice(eq + 1).slice(0, 40) : 'REDACTED'}`);
  }
  return out.join('&');
}

/** Caminho de servidor: a rota parametrizada quando houver; senão só o 1º segmento literal. */
export function serverPath(route: unknown, rawPath: unknown): string | undefined {
  if (typeof route === 'string' && route) return route;
  if (typeof rawPath !== 'string') return undefined;
  const segs = rawPath.split('?')[0].split('/');
  return segs
    .map((s, i) => (i === 0 || s === '' ? s : i === 1 && /^[a-z][a-z-]{0,30}$/.test(s) ? s : '{id}'))
    .join('/');
}

export function maskClientPath(path: string): string {
  return path
    .replace(TELEGRAM_BOT_TOKEN, '/bot{token}')
    .split('/')
    .map((s) => (s === '' || SAFE_CLIENT_SEGMENTS.has(s) || VERSION_SEGMENT.test(s) || TELEGRAM_METHOD.test(s) ? s : '{id}'))
    .join('/');
}

/** url.full de cliente: origem + caminho mascarado, sem query/fragmento. */
export function clientUrl(full: string): string {
  try {
    const u = new URL(full);
    return `${u.protocol}//${u.host}${maskClientPath(u.pathname)}`;
  } catch {
    return maskClientPath(full.split(/[?#]/)[0]);
  }
}
