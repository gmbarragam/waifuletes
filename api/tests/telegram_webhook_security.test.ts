import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

describe('SEC-01: Telegram Webhook Authentication & Security', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { telegramRoutes } = await import('../src/routes/web/telegramRoutes.js');
    app = Fastify({ logger: false });
    app.decorate('prisma', {} as any);
    app.decorate('redis', {} as any);
    await app.register(telegramRoutes);
    await app.ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('deve derivar webhook secret via HMAC determinístico quando TELEGRAM_BOT_TOKEN estiver presente', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();
    const secret = service.getWebhookSecret();

    expect(secret).toBeDefined();
    expect(typeof secret).toBe('string');
    expect(secret?.length).toBeGreaterThan(0);
    // Deve conter apenas caracteres válidos [A-Za-z0-9_-] conforme especificação da Telegram Bot API
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('validateWebhookSecret deve rejeitar requisição com segredo ausente ou incorreto', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();

    expect(service.validateWebhookSecret(undefined)).toBe(false);
    expect(service.validateWebhookSecret('')).toBe(false);
    expect(service.validateWebhookSecret('token_invalido_qualquer')).toBe(false);

    const validSecret = service.getWebhookSecret();
    expect(service.validateWebhookSecret(validSecret)).toBe(true);
  });

  it('POST /api/telegram/webhook deve retornar 401 Unauthorized se o header X-Telegram-Bot-Api-Secret-Token estiver ausente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      payload: {
        update_id: 123456,
        callback_query: {
          id: 'unauth_query',
          data: 'sug_app:fake_id',
          from: { id: 999, first_name: 'Attacker' },
          message: { message_id: 1, chat: { id: 999 } },
        },
      },
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Unauthorized');
    expect(json.message).toContain('secret token');
  });

  it('POST /api/telegram/webhook deve retornar 401 Unauthorized se o header contiver token forjado ou inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: {
        'x-telegram-bot-api-secret-token': 'token_completamente_falso',
      },
      payload: {
        update_id: 123456,
        callback_query: {
          id: 'forged_query',
          data: 'sug_app_rar:fake_id:LEGENDARY',
        },
      },
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Unauthorized');
  });

  it('POST /api/telegram/webhook deve aceitar com 200 OK quando o header contiver o segredo correto', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();
    const validSecret = service.getWebhookSecret();

    const res = await app.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: {
        'x-telegram-bot-api-secret-token': validSecret,
      },
      payload: {
        update_id: 123456,
        message: {
          message_id: 10,
          chat: { id: 123 },
          text: 'ping',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
  });

  it('registerWebhook deve enviar secret_token no corpo da chamada ao setWebhook', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();
    const expectedSecret = service.getWebhookSecret();

    let capturedUrl = '';
    let capturedBody: any = null;

    const originalFetch = global.fetch;
    try {
      global.fetch = (async (url: any, opts: any) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(opts.body);
        return {
          json: async () => ({ ok: true, result: true }),
        } as any;
      }) as any;

      const result = await service.registerWebhook('https://waifu.example.com');
      expect(result).toBe(true);
      expect(capturedUrl).toContain('/setWebhook');
      expect(capturedBody.url).toBe('https://waifu.example.com/api/telegram/webhook');
      expect(capturedBody.secret_token).toBe(expectedSecret);
      expect(capturedBody.allowed_updates).toContain('callback_query');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('handleCallback deve rejeitar requisição de chat não autorizado quando fora de teste', async () => {
    const { TelegramNotificationService } = await import('../src/services/TelegramNotificationService.js');
    const service = new TelegramNotificationService();
    (service as any).botToken = 'mock_bot_token';
    (service as any).chatId = '-1009999999';

    let answerText = '';
    (service as any).answerCallback = async (_id: string, text: string) => {
      answerText = text;
    };

    const prevVitest = process.env.VITEST;
    const prevNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';

    try {
      const maliciousCallback = {
        id: 'query_hacker',
        data: 'sug_app:fake_suggestion_id',
        from: { id: 666, first_name: 'Attacker' },
        message: {
          chat: { id: -1001111111 }, // Chat diferente do esperado
          message_id: 42,
        },
      };

      const mockSuggestionService = {
        approveSuggestion: async () => {
          throw new Error('NÃO DEVERIA TER SIDO CHAMADO!');
        },
      };

      await service.handleCallback(maliciousCallback, mockSuggestionService);
      expect(answerText).toBe('Não autorizado.');
    } finally {
      if (prevVitest) process.env.VITEST = prevVitest;
      if (prevNodeEnv) process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
