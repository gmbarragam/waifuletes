import { describe, it, expect, beforeAll } from 'vitest';

// Vetores fixos calculados de forma independente (salt de teste, nunca o de produção):
//   node -e 'const c=require("crypto");const h=x=>c.createHmac("sha256","otel-test-salt").update(x).digest("hex").slice(0,16);console.log(h("5511900000081"),h("120363000000000081@g.us"))'
// e conferidos contra hashUserId/hashId de ravena-ai/src/telemetry/index.js com o mesmo salt.
const SALT = 'otel-test-salt';
const USER_HASH = '6199a6095d61215c';
const GROUP_HASH = 'c61be2ba80cbaed0';

let t: typeof import('../src/telemetry.js');

beforeAll(async () => {
  process.env.OTEL_ID_SALT = SALT; // lido no carregamento do módulo
  (globalThis as any).__OTEL_ENABLED = true;
  t = await import('../src/telemetry.js');
});

describe('telemetry hashUserId (mesma entrada de HMAC da ravena-ai)', () => {
  it('normaliza sufixo do WhatsApp e :device, de forma idempotente', () => {
    expect(t.normalizeUserId('5511900000081@c.us')).toBe('5511900000081');
    expect(t.normalizeUserId('5511900000081:3@s.whatsapp.net')).toBe('5511900000081');
    expect(t.normalizeUserId('5511900000081@lid')).toBe('5511900000081');
    expect(t.normalizeUserId(t.normalizeUserId('5511900000081:3@s.whatsapp.net'))).toBe('5511900000081');
    expect(t.normalizeUserId('')).toBeUndefined();
  });

  it('mesmo hash para as três formas do mesmo usuário e igual ao vetor da ravena', () => {
    const a = t.hashUserId('5511900000081@c.us');
    expect(a).toBe(USER_HASH);
    expect(t.hashUserId('5511900000081')).toBe(a);
    expect(t.hashUserId('5511900000081:3@s.whatsapp.net')).toBe(a);
  });

  it('grupo usa o ID completo, sem normalizar', () => {
    expect(t.hashId('120363000000000081@g.us')).toBe(GROUP_HASH);
    expect(t.hashId('120363000000000081@g.us')).not.toBe(t.hashId('120363000000000081'));
  });

  it('desligado: não calcula hash', () => {
    (globalThis as any).__OTEL_ENABLED = false;
    try {
      expect(t.hashUserId('5511900000081')).toBeUndefined();
    } finally {
      (globalThis as any).__OTEL_ENABLED = true;
    }
  });
});
