import { describe, it, expect, beforeAll } from 'vitest';

// Mesmo formato de ID nos 3 serviços (ravena-ai/src/telemetry/index.js → userIdAttr/chatIdAttr):
// usuário sem sufixo do WhatsApp nem :device; grupo com o ID completo.
let t: typeof import('../src/telemetry.js');

beforeAll(async () => {
  (globalThis as any).__OTEL_ENABLED = true;
  t = await import('../src/telemetry.js');
});

describe('telemetry userIdAttr/chatIdAttr (mesmo formato da ravena-ai)', () => {
  it('normaliza sufixo do WhatsApp e :device, de forma idempotente', () => {
    expect(t.normalizeUserId('5511900000081@c.us')).toBe('5511900000081');
    expect(t.normalizeUserId('5511900000081:3@s.whatsapp.net')).toBe('5511900000081');
    expect(t.normalizeUserId('5511900000081@lid')).toBe('5511900000081');
    expect(t.normalizeUserId(t.normalizeUserId('5511900000081:3@s.whatsapp.net'))).toBe('5511900000081');
    expect(t.normalizeUserId('')).toBeUndefined();
  });

  it('mesmo ID para as três formas do mesmo usuário', () => {
    expect(t.userIdAttr('5511900000081@c.us')).toBe('5511900000081');
    expect(t.userIdAttr('5511900000081')).toBe('5511900000081');
    expect(t.userIdAttr('5511900000081:3@s.whatsapp.net')).toBe('5511900000081');
  });

  it('grupo usa o ID completo, sem normalizar', () => {
    expect(t.chatIdAttr('120363000000000081@g.us')).toBe('120363000000000081@g.us');
    expect(t.chatIdAttr('')).toBeUndefined();
  });

  it('desligado: não grava ID', () => {
    (globalThis as any).__OTEL_ENABLED = false;
    try {
      expect(t.userIdAttr('5511900000081')).toBeUndefined();
      expect(t.chatIdAttr('120363000000000081@g.us')).toBeUndefined();
    } finally {
      (globalThis as any).__OTEL_ENABLED = true;
    }
  });
});
