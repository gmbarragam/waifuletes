import { describe, it, expect } from 'vitest';
import { sanitizeQuery, serverPath, clientUrl } from '../src/telemetryUrl.js';

describe('telemetryUrl', () => {
  it('url.path de servidor vem da rota; sem rota mascara segmentos', () => {
    expect(serverPath('/user/:userId/cooldowns', '/user/abcUser9/cooldowns?x=1')).toBe('/user/:userId/cooldowns');
    expect(serverPath(undefined, '/harem/abcUser9/xyz?search=fulano')).toBe('/harem/{id}/{id}');
  });

  it('query só mantém valores da allowlist', () => {
    expect(sanitizeQuery('search=fulano&limit=5&nome=x&rarity=EPIC')).toBe('search=REDACTED&limit=5&nome=REDACTED&rarity=EPIC');
  });

  it('url.full de cliente: origem + caminho mascarado, sem query', () => {
    expect(clientUrl('http://ravena:5000/api/market/user-inventory/5511900000071?x=1')).toBe('http://ravena:5000/api/market/user-inventory/{id}');
    expect(clientUrl('http://hub/api/v1/external/characters/2f1c9a7e-1111-2222-3333-444455556666')).toBe('http://hub/api/v1/external/characters/{id}');
    expect(clientUrl('https://api.telegram.org/bot123:ABC_def/sendMessage')).toBe('https://api.telegram.org/bot{token}/sendMessage');
    expect(clientUrl('http://jds:3040/inventory/abcUser9')).toBe('http://jds:3040/inventory/{id}');
  });
});
