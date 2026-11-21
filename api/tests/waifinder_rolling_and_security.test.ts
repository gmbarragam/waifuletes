import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

describe('Waifinder Rolling Mode, Fazenda/Donate & Anti-Abuse Security', () => {
  let server: any;
  let mockRavenaServer: http.Server;
  let mockRavenaState = {
    available: true,
    farmRolls: 1,
    farmTickets: 1,
    extraMaxRolls: 3,
    refunds: [] as Array<{ userId: string; type: string }>,
    legendaryNotifs: [] as any[],
  };

  const suffix = `${Date.now()}`;
  const userId = `test_waifinder_${suffix}`;
  const otherUserId = `test_waifinder_other_${suffix}`;
  const groupId = `test_grp_waifinder_${suffix}@g.us`;
  let token = '';
  let publicId = '';
  let otherToken = '';
  let otherPublicId = '';
  const marriedCharIds: string[] = [];
  const createdSessionTokens: string[] = [];

  beforeAll(async () => {
    // Sobe servidor HTTP mock para simular as rotas internas da Ravena (/api/waifu/* e /api/market/*)
    mockRavenaServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (!mockRavenaState.available) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'Ravena mock down' }));
          return;
        }

        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let body: any = {};
        try {
          if (bodyStr) body = JSON.parse(bodyStr);
        } catch {}

        res.setHeader('Content-Type', 'application/json');

        if (req.url?.startsWith('/api/waifu/user-roll-context/')) {
          res.end(
            JSON.stringify({
              success: true,
              data: {
                donorBonuses: { extraMaxRolls: mockRavenaState.extraMaxRolls },
                extraMaxRolls: mockRavenaState.extraMaxRolls,
                farmRolls: mockRavenaState.farmRolls,
                farmTickets: mockRavenaState.farmTickets,
                eventRarosMult: 1.0,
                eventWishMult: 1.0,
              },
            })
          );
          return;
        }

        if (req.url === '/api/waifu/farm-bonus/reserve' && req.method === 'POST') {
          let reserved = false;
          let type: 'ticket' | 'roll' | null = null;
          if (mockRavenaState.farmTickets > 0) {
            mockRavenaState.farmTickets -= 1;
            reserved = true;
            type = 'ticket';
          } else if (mockRavenaState.farmRolls > 0) {
            mockRavenaState.farmRolls -= 1;
            reserved = true;
            type = 'roll';
          }

          res.end(
            JSON.stringify({
              success: true,
              data: {
                reserved,
                type,
                remainingRolls: mockRavenaState.farmRolls,
                remainingTickets: mockRavenaState.farmTickets,
                donorBonuses: { extraMaxRolls: mockRavenaState.extraMaxRolls },
                extraMaxRolls: mockRavenaState.extraMaxRolls,
                eventRarosMult: 1.0,
                eventWishMult: 1.0,
              },
            })
          );
          return;
        }

        if (req.url === '/api/waifu/farm-bonus/refund' && req.method === 'POST') {
          mockRavenaState.refunds.push({ userId: body.userId, type: body.type });
          if (body.type === 'ticket') mockRavenaState.farmTickets += 1;
          if (body.type === 'roll') mockRavenaState.farmRolls += 1;
          res.end(JSON.stringify({ success: true, refunded: true }));
          return;
        }

        if (req.url === '/api/market/notify-legendary-marriage' && req.method === 'POST') {
          mockRavenaState.legendaryNotifs.push(body);
          res.end(JSON.stringify({ success: true, notified: true }));
          return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ success: false }));
      });
    });

    await new Promise<void>((resolve) => {
      mockRavenaServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockRavenaServer.address() as any;
    process.env.RAVENA_API_URL = `http://127.0.0.1:${addr.port}`;

    const { config } = await import('../src/config.js');
    config.RAVENA_API_URL = process.env.RAVENA_API_URL;

    const { buildServer } = await import('../src/server.js');
    server = await buildServer();
    await server.ready();

    // Cria usuários e sessões web
    await server.prisma.user.create({
      data: { id: userId, name: 'Waifinder Tester', platform: 'WHATSAPP', kakera: 100 },
    });
    await server.prisma.group.create({
      data: { id: groupId, name: 'Grupo Waifinder Test', platform: 'WHATSAPP' },
    });
    await server.prisma.userGroup.create({
      data: { userId, groupId },
    });

    await server.prisma.user.create({
      data: { id: otherUserId, name: 'Other Tester', platform: 'WHATSAPP', kakera: 100 },
    });

    const { WebSessionService } = await import('../src/services/WebSessionService.js');
    const ws = new WebSessionService(server.redis, server.prisma);
    const s1 = await ws.createUserSession(userId);
    const s2 = await ws.createUserSession(otherUserId);
    token = s1.token;
    publicId = s1.publicId;
    otherToken = s2.token;
    otherPublicId = s2.publicId;
    createdSessionTokens.push(token, otherToken);
  });

  afterAll(async () => {
    try {
      // Desfaz casamentos criados nos testes e restaura claimCount
      for (const charId of marriedCharIds) {
        await server.prisma.haremEntry.deleteMany({
          where: { characterId: charId, userId: { in: [userId, otherUserId] } },
        });
        await server.prisma.character.update({
          where: { id: charId },
          data: { claimCount: { decrement: 1 } },
        }).catch(() => {});
      }

      await server.prisma.kakeraTransaction.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
      await server.prisma.userGroup.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
      await server.prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
      await server.prisma.group.deleteMany({ where: { id: groupId } });

      // Limpa chaves Redis criadas pelo teste
      const keysToDel = [
        `rolls:${userId}`,
        `rolls:${otherUserId}`,
        `waifinder:active_roll:${userId}`,
        `waifinder:active_roll:${otherUserId}`,
        `waifinder:roll:lock:${userId}`,
        `waifinder:roll:lock:${otherUserId}`,
        `seen:${userId}:${groupId}`,
        `seen:${userId}:WAIFINDER`,
        `seen:${otherUserId}:WAIFINDER`,
        ...createdSessionTokens.map((t) => `web:session:${t}`),
      ];
      for (const r of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']) {
        keysToDel.push(`cooldown:claim:${userId}:${r}`, `cooldown:daily:marry:${userId}:${r}`);
        keysToDel.push(`cooldown:claim:${otherUserId}:${r}`, `cooldown:daily:marry:${otherUserId}:${r}`);
      }
      await server.redis.del(...keysToDel);
    } finally {
      if (server) await server.close();
      if (mockRavenaServer) await new Promise<void>((resolve) => mockRavenaServer.close(() => resolve()));
    }
  });

  it('GET /api/web/catalog/deck deve retornar wishlistCount, numericId e total de rolls (normais + fazenda + tickets)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/web/catalog/deck?token=${encodeURIComponent(token)}`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.data.authenticated).toBe(true);
    expect(json.data.user.name).toBe('Waifinder Tester');
    // maxRolls = 9 base + 3 extraMaxRolls = 12; available = 12 normais + 1 farmRoll + 1 farmTicket = 14
    expect(json.data.user.rolls.maxRolls).toBe(12);
    expect(json.data.user.rolls.availableRolls).toBe(14);
    expect(json.data.characters.length).toBeGreaterThan(0);
    expect(typeof json.data.characters[0].wishlistCount).toBe('number');
  });

  it('POST /waifinder/roll deve ignorar/strip injeção de bonuses/extraMaxRolls no payload (Fastify removeAdditional)', async () => {
    // Limpa lock single-flight e configura apenas bônus do servidor (extraMaxRolls = 3)
    await server.redis.del(`waifinder:roll:lock:${userId}`);
    const prevTickets = mockRavenaState.farmTickets;
    const prevRolls = mockRavenaState.farmRolls;
    mockRavenaState.farmTickets = 0;
    mockRavenaState.farmRolls = 0;

    const res = await server.inject({
      method: 'POST',
      url: `/api/web/user/${publicId}/waifinder/roll`,
      payload: {
        token,
        bonuses: { isFreeRoll: true, extraMaxRolls: 500 },
      },
    });

    // Fastify removeAdditional remove `bonuses` antes do handler (nunca aceita do cliente)
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.maxRolls).toBe(12); // 9 base + 3 server-side (nunca 509!)
    expect(json.data.usedFarmBonus).toBeNull();
    // Consumiu 1 roll normal (12 -> 11) em vez de obedecer `isFreeRoll: true` injetado
    expect(json.data.rolls.baseAvailableRolls).toBe(11);

    mockRavenaState.farmTickets = prevTickets;
    mockRavenaState.farmRolls = prevRolls;
  });

  it('POST /waifinder/roll sem sessão válida deve retornar 401 UNAUTHORIZED', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/web/user/${publicId}/waifinder/roll`,
      payload: { token: 'token-invalido' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /waifinder/roll deve falhar fechado (503) quando a Ravena estiver indisponível sem consumir roll do Redis', async () => {
    mockRavenaState.available = false;
    const beforeRaw = await server.redis.get(`rolls:${userId}`);

    const res = await server.inject({
      method: 'POST',
      url: `/api/web/user/${publicId}/waifinder/roll`,
      payload: { token, gender: 'ALL' },
    });

    mockRavenaState.available = true;
    const afterRaw = await server.redis.get(`rolls:${userId}`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('RAVENA_UNAVAILABLE');
    expect(afterRaw).toBe(beforeRaw);
  });

  it('POST /waifinder/roll deve consumir bônus da fazenda antes do saldo Redis e devolver dados completos do card', async () => {
    // Garante tempo livre do lock single-flight
    await server.redis.del(`waifinder:roll:lock:${userId}`);

    const res = await server.inject({
      method: 'POST',
      url: `/api/web/user/${publicId}/waifinder/roll`,
      payload: { token, gender: 'ALL' },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.data.character).toBeDefined();
    expect(typeof json.data.character.likeCount).toBe('number');
    expect(typeof json.data.character.wishlistCount).toBe('number');

    // Se não sorteou mítico, o ticket (1º da prioridade) foi consumido; baseAvailableRolls permanece 11 (saldo normal intacto)
    if (!json.data.isMythic) {
      expect(json.data.usedFarmBonus).toBe('ticket');
      expect(json.data.rolls.baseAvailableRolls).toBe(11);
      expect(json.data.rolls.farmTickets).toBe(0);
      expect(json.data.rolls.farmRolls).toBe(1);
    } else {
      expect(mockRavenaState.refunds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('POST /waifinder/marry deve bloquear roubo de personagem rolado em grupo do WhatsApp e bloquear carta não rolada no Waifinder', async () => {
    const singleChar = await server.prisma.character.findFirst({
      where: { isActive: true, isMythic: false, haremEntries: { none: {} } },
      select: { id: true },
    });
    expect(singleChar).toBeTruthy();

    // Simula lock criado por outro usuário em um grupo real do WhatsApp
    await server.redis.set(`lock:char:${groupId}:${singleChar!.id}`, otherUserId, 'EX', 300);

    const stealRes = await server.inject({
      method: 'POST',
      url: `/api/web/user/${publicId}/waifinder/marry`,
      payload: {
        token,
        characterId: singleChar!.id,
      },
    });

    await server.redis.del(`lock:char:${groupId}:${singleChar!.id}`);
    expect(stealRes.statusCode).toBe(400);
    expect(stealRes.json().error.code).toBe('LOCK_EXPIRED');
  });

  it('POST /waifinder/marry deve casar com o personagem ativo do Waifinder, gravar grupo recente e retornar cota diária restante', async () => {
    // Garante um personagem solteiro ativo como active_roll do usuário
    const freeChar = await server.prisma.character.findFirst({
      where: {
        isActive: true,
        isMythic: false,
        baseRarity: 'COMMON',
        haremEntries: { none: {} },
      },
      select: { id: true, name: true },
    });
    expect(freeChar).toBeTruthy();

    await server.redis.set(`lock:char:waifinder:${userId}:${freeChar!.id}`, userId, 'EX', 300);
    await server.redis.set(
      `waifinder:active_roll:${userId}`,
      JSON.stringify({ characterId: freeChar!.id, rolledAt: Date.now() }),
      'EX',
      300
    );

    const marryRes = await server.inject({
      method: 'POST',
      url: `/api/web/user/${publicId}/waifinder/marry`,
      payload: {
        token,
        characterId: freeChar!.id,
      },
    });

    expect(marryRes.statusCode).toBe(200);
    const json = marryRes.json();
    expect(json.success).toBe(true);
    expect(json.data.character.id).toBe(freeChar!.id);
    expect(json.data.dailyMarry).toBeDefined();
    expect(json.data.dailyMarry.limit).toBe(25);
    expect(json.data.dailyMarry.remaining).toBe(24);

    marriedCharIds.push(freeChar!.id);

    const entry = await server.prisma.haremEntry.findUnique({
      where: { characterId: freeChar!.id },
      select: { userId: true, claimedInGroup: true },
    });
    expect(entry?.userId).toBe(userId);
    expect(entry?.claimedInGroup).toBe(groupId);
  });
});
