import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

// Os retratos de saldo (total, quintos, top 10%) dependem da base INTEIRA, então esta suíte roda num banco
// descartável próprio (criado e migrado aqui, removido no fim), sem tocar nos dados de desenvolvimento.
const BASE_URL = process.env.DATABASE_URL || '';
const TEST_DB = `econ_summary_test_${Date.now()}`;
const testUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
})();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Janela dos fluxos (início de hora em UTC) e janela das entradas por quinto, longe uma da outra.
const FLOW_BASE = Date.UTC(2026, 0, 10, 12, 0, 0);
const RECV_BASE = Date.UTC(2026, 1, 1, 0, 0, 0);
const OLD_TS = Date.UTC(2020, 5, 1, 3, 30, 0);
const SPLIT_BASE = Date.UTC(2026, 2, 1, 9, 0, 0);
const SOUL_BASE = Date.UTC(2026, 3, 1, 10, 0, 0);

const hid = (i: number) => `econ_h${String(i).padStart(2, '0')}`;

describe('📊 GET /internal/economy/summary — resumo da economia (Zinthos)', () => {
  let admin: PrismaClient;
  let server: any;
  let dbCreated = false;

  const get = (url: string, headers: Record<string, string> = { authorization: `Bearer ${API_KEY}` }) =>
    server.inject({ method: 'GET', url, headers });

  beforeAll(async () => {
    expect(API_KEY, 'API_KEY/API_KEYS precisa estar configurada para os testes').toBeTruthy();
    admin = new PrismaClient({ datasources: { db: { url: BASE_URL } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
    dbCreated = true;
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: testUrl }, stdio: 'ignore' });

    process.env.DATABASE_URL = testUrl;
    const { buildServer } = await import('../src/server.js');
    server = await buildServer();
    await server.ready();
    const prisma: PrismaClient = server.prisma;

    // 50 contas com saldo 10, 20, ..., 500 e 3 contas zeradas.
    await prisma.user.createMany({
      data: [
        ...Array.from({ length: 50 }, (_, k) => ({ id: hid(k + 1), name: `Econ ${k + 1}`, kakera: (k + 1) * 10 })),
        ...[1, 2, 3].map((k) => ({ id: `econ_zero_${k}`, name: `Zero ${k}`, kakera: 0 })),
      ],
    });

    const tx = (userId: string, amount: number, reason: any, at: number, metadata?: any) => ({
      userId,
      amount,
      reason,
      createdAt: new Date(at),
      ...(metadata !== undefined ? { metadata } : {}),
    });
    await prisma.kakeraTransaction.createMany({
      data: [
        // Hora FLOW_BASE
        tx(hid(50), 100, 'DAILY_REWARD', FLOW_BASE + 5 * 60_000),
        tx(hid(1), 50, 'DAILY_REWARD', FLOW_BASE + 10 * 60_000),
        tx(hid(50), -30, 'MARKET_BUY', FLOW_BASE + 20 * 60_000),
        tx(hid(50), 20, 'DAILY_REWARD', FLOW_BASE + HOUR - 1),
        // Hora FLOW_BASE + 1h
        tx(hid(1), -40, 'HOSTING_FEE', FLOW_BASE + HOUR),
        tx(hid(25), 10, 'MARKET_TRADE', FLOW_BASE + HOUR + 1),
        tx(hid(25), -5, 'MARKET_TRADE', FLOW_BASE + HOUR + 2),
        // Fora da janela [FLOW_BASE, FLOW_BASE + 2h)
        tx(hid(2), 7, 'DAILY_REWARD', FLOW_BASE - 1),
        tx(hid(2), 9, 'DAILY_REWARD', FLOW_BASE + 2 * HOUR),
        // Histórico antigo (só aparece com from=0)
        tx(hid(3), 1000, 'ADMIN_GRANT', OLD_TS),

        // Janela de entradas [RECV_BASE, RECV_BASE + 7d): o 1º quinto (h01..h10) recebe 10, 20, ..., 100
        ...Array.from({ length: 10 }, (_, k) => tx(hid(k + 1), (k + 1) * 10, 'ROLL_CRYSTAL', RECV_BASE + k * HOUR)),
        // Não são motivos de criação: não entram em receivedSum
        tx(hid(1), 1000, 'ADMIN_GRANT', RECV_BASE + DAY),
        tx(hid(1), 500, 'MARKET_TRADE', RECV_BASE + DAY),
        tx(hid(1), 300, 'HOSTING_FEE_WAIFU', RECV_BASE + DAY),
        tx(hid(1), -20, 'MARKET_BUY', RECV_BASE + DAY),
        // 5º quinto: só h50 recebe
        tx(hid(50), 700, 'DIVORCE', RECV_BASE + 2 * DAY),
        // 2º quinto (h11): prêmio do caça-níquel e bônus de doador contam como criação; câmbio do banco não
        tx(hid(11), 15, 'ADMIN_GRANT', RECV_BASE + 3 * DAY, { source: 'SLOTS_PRIZE' }),
        tx(hid(11), 5, 'ADMIN_GRANT', RECV_BASE + 3 * DAY, { source: 'DONOR_BONUS', donorName: 'x' }),
        tx(hid(11), 400, 'ADMIN_GRANT', RECV_BASE + 3 * DAY, { reason: 'bank_withdraw_zinthos' }),

        // Hora SPLIT_BASE: ADMIN_GRANT separado por metadata.reason / metadata.source
        tx(hid(20), 100, 'ADMIN_GRANT', SPLIT_BASE + 1, { reason: 'bank_withdraw_zinthos' }),
        tx(hid(21), 100, 'ADMIN_GRANT', SPLIT_BASE + 2, { reason: 'bank_withdraw_zinthos' }),
        tx(hid(20), -50, 'ADMIN_GRANT', SPLIT_BASE + 3, { reason: 'bank_deposit_runas' }),
        tx(hid(20), 30, 'ADMIN_GRANT', SPLIT_BASE + 4, { source: 'SLOTS_PRIZE' }),
        tx(hid(20), 20, 'ADMIN_GRANT', SPLIT_BASE + 5, { reason: '', source: 'DONOR_BONUS' }),
        tx(hid(20), 5, 'ADMIN_GRANT', SPLIT_BASE + 6),
        tx(hid(20), 6, 'ADMIN_GRANT', SPLIT_BASE + 7, { reason: 5 }),
        tx(hid(20), 7, 'ADMIN_GRANT', SPLIT_BASE + 8, { reason: "x'; DROP TABLE users;--" }),
        tx(hid(20), 8, 'ADMIN_GRANT', SPLIT_BASE + 9, { reason: 'a'.repeat(65) }),
        tx(hid(20), 9, 'ADMIN_GRANT', SPLIT_BASE + 10, { reason: 'a'.repeat(64) }),
        tx(hid(20), 10, 'ADMIN_GRANT', SPLIT_BASE + 11, { reason: 'Bank-Deposit' }),
        tx(hid(20), 11, 'DIVORCE', SPLIT_BASE + 12, { reason: 'bank_withdraw_zinthos', forced: true }),

        // Logo após o fim da janela de 7 dias
        tx(hid(1), 9999, 'DAILY_REWARD', RECV_BASE + 7 * DAY),
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (server) await server.close();
    if (dbCreated) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin?.$disconnect();
  });

  describe('autenticação', () => {
    it('recusa sem Authorization (401)', async () => {
      const res = await get(`/internal/economy/summary?from=0&to=${Date.now()}`, {});
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('recusa chave errada (401)', async () => {
      const res = await get(`/internal/economy/summary?from=0&to=${Date.now()}`, { authorization: 'Bearer chave_errada' });
      expect(res.statusCode).toBe(401);
    });

    it('autentica antes de validar os parâmetros (401, não 400)', async () => {
      const res = await get('/internal/economy/summary?from=abc', {});
      expect(res.statusCode).toBe(401);
    });
  });

  describe('validação (400)', () => {
    const now = Date.now();
    it.each([
      ['sem parâmetros', ''],
      ['sem to', '?from=0'],
      ['from não numérico', `?from=abc&to=${now}`],
      ['from negativo', `?from=-1&to=${now}`],
      ['from fracionário', `?from=1.5&to=${now}`],
      ['to igual a from', `?from=${FLOW_BASE}&to=${FLOW_BASE}`],
      ['to menor que from', `?from=${FLOW_BASE}&to=${FLOW_BASE - 1}`],
      ['to além de agora + 60s', `?from=0&to=${now + 5 * 60_000}`],
      ['received inválido', `?from=${FLOW_BASE}&to=${FLOW_BASE + HOUR}&received=2`],
      ['balances inválido', `?from=${FLOW_BASE}&to=${FLOW_BASE + HOUR}&balances=2`],
      ['balances não numérico', `?from=${FLOW_BASE}&to=${FLOW_BASE + HOUR}&balances=sim`],
    ])('%s', async (_label, qs) => {
      const res = await get(`/internal/economy/summary${qs}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
    });

    it('aceita to até agora + 60s', async () => {
      const res = await get(`/internal/economy/summary?from=${Date.now() - HOUR}&to=${Date.now() + 30_000}`);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('fluxos do extrato', () => {
    it('agrega por hora UTC e motivo, separando entradas e saídas', async () => {
      const res = await get(`/internal/economy/summary?from=${FLOW_BASE}&to=${FLOW_BASE + 2 * HOUR}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.currency).toBe('zinthos');
      expect(body.schemaVersion).toBe(1);
      expect(body.window).toEqual({ from: FLOW_BASE, to: FLOW_BASE + 2 * HOUR });
      expect(typeof body.generatedAt).toBe('number');
      expect(body.ledger.available).toBe(true);
      expect(body.ledger.flows).toEqual([
        { hour: FLOW_BASE, reason: 'DAILY_REWARD', amountIn: 170, amountOut: 0, count: 3, users: 2 },
        { hour: FLOW_BASE, reason: 'MARKET_BUY', amountIn: 0, amountOut: 30, count: 1, users: 1 },
        { hour: FLOW_BASE + HOUR, reason: 'HOSTING_FEE', amountIn: 0, amountOut: 40, count: 1, users: 1 },
        { hour: FLOW_BASE + HOUR, reason: 'MARKET_TRADE', amountIn: 10, amountOut: 5, count: 2, users: 1 },
      ]);
    });

    it('from inclusivo e to exclusivo', async () => {
      const res = await get(`/internal/economy/summary?from=${FLOW_BASE + HOUR}&to=${FLOW_BASE + HOUR + 2}`);
      const flows = res.json().ledger.flows;
      expect(flows).toEqual([
        { hour: FLOW_BASE + HOUR, reason: 'HOSTING_FEE', amountIn: 0, amountOut: 40, count: 1, users: 1 },
        { hour: FLOW_BASE + HOUR, reason: 'MARKET_TRADE', amountIn: 10, amountOut: 0, count: 1, users: 1 },
      ]);
    });

    it('from=0 traz o histórico inteiro', async () => {
      const res = await get(`/internal/economy/summary?from=0&to=${Date.now()}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const flows = body.ledger.flows as any[];
      expect(flows[0]).toEqual({
        hour: Date.UTC(2020, 5, 1, 3, 0, 0),
        reason: 'ADMIN_GRANT',
        amountIn: 1000,
        amountOut: 0,
        count: 1,
        users: 1,
      });
      expect(flows.find((f) => f.hour === FLOW_BASE - HOUR)).toMatchObject({ reason: 'DAILY_REWARD', amountIn: 7 });
      expect(flows.find((f) => f.hour === FLOW_BASE + 2 * HOUR)).toMatchObject({ reason: 'DAILY_REWARD', amountIn: 9 });
      const totalCount = flows.reduce((s, f) => s + f.count, 0);
      expect(totalCount).toBe(26 + 3 + 12);
      // Sem IDs de jogador em lugar nenhum da resposta.
      expect(res.body).not.toMatch(/econ_/);
    });
  });

  describe('ADMIN_GRANT separado pelo metadata', () => {
    it('usa metadata.reason (ou metadata.source) como sufixo, saneado', async () => {
      const res = await get(`/internal/economy/summary?from=${SPLIT_BASE}&to=${SPLIT_BASE + HOUR}`);
      const flows = res.json().ledger.flows as any[];
      const f = (reason: string, amountIn: number, amountOut: number, count: number, users: number) => ({
        hour: SPLIT_BASE,
        reason,
        amountIn,
        amountOut,
        count,
        users,
      });
      const expected = [
        f('ADMIN_GRANT:bank_withdraw_zinthos', 200, 0, 2, 2),
        f('ADMIN_GRANT:bank_deposit_runas', 0, 50, 1, 1),
        f('ADMIN_GRANT:slots_prize', 30, 0, 1, 1),
        f('ADMIN_GRANT:donor_bonus', 20, 0, 1, 1),
        // sem metadata ou reason que não é texto: motivo cru
        f('ADMIN_GRANT', 11, 0, 2, 1),
        // injeção, 65 caracteres e caractere fora de [a-z0-9_]
        f('ADMIN_GRANT:other', 25, 0, 3, 1),
        f(`ADMIN_GRANT:${'a'.repeat(64)}`, 9, 0, 1, 1),
        // metadata.reason em outro motivo não muda nada
        f('DIVORCE', 11, 0, 1, 1),
      ];
      expect(flows).toHaveLength(expected.length);
      expect(flows).toEqual(expect.arrayContaining(expected));
      for (const row of flows) expect(row.reason).toMatch(/^[A-Z_]+(:[a-z0-9_]{1,64})?$/);
    });
  });

  describe('retrato dos saldos', () => {
    it('total, contas, holders, p50/p90, top10Share e quintos', async () => {
      const res = await get(`/internal/economy/summary?from=${FLOW_BASE}&to=${FLOW_BASE + HOUR}`);
      const { balances } = res.json();
      expect(balances.total).toBe(12750);
      expect(balances.accounts).toBe(53);
      expect(balances.holders).toBe(50);
      expect(balances.p50).toBe(250);
      expect(balances.p90).toBe(450);
      expect(balances.top10Share).toBeCloseTo(2400 / 12750, 10);
      expect(balances.quintiles).toEqual([
        { q: 1, n: 10, min: 10, max: 100, sum: 550 },
        { q: 2, n: 10, min: 110, max: 200, sum: 1550 },
        { q: 3, n: 10, min: 210, max: 300, sum: 2550 },
        { q: 4, n: 10, min: 310, max: 400, sum: 3550 },
        { q: 5, n: 10, min: 410, max: 500, sum: 4550 },
      ]);
    });
  });

  describe('parâmetro balances', () => {
    const qs = `from=${RECV_BASE}&to=${RECV_BASE + 7 * DAY}&received=1`;

    it('padrão (sem o parâmetro) é igual a balances=1 e traz o retrato', async () => {
      const dflt = (await get(`/internal/economy/summary?${qs}`)).json();
      const one = (await get(`/internal/economy/summary?${qs}&balances=1`)).json();
      expect(dflt.balances).toMatchObject({ total: 12750, totalAtWindowEnd: 12750 - 9999 - 256, holders: 50, accounts: 53 });
      expect(dflt.balances.quintiles).toHaveLength(5);
      expect(dflt.receivedByQuintile).toHaveLength(5);
      expect(one.balances).toEqual(dflt.balances);
      expect(one.receivedByQuintile).toEqual(dflt.receivedByQuintile);
      expect(one.ledger).toEqual(dflt.ledger);
    });

    it('balances=0 devolve balances: null, os mesmos fluxos e receivedByQuintile []', async () => {
      const dflt = (await get(`/internal/economy/summary?${qs}`)).json();
      const res = await get(`/internal/economy/summary?${qs}&balances=0`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.balances).toBeNull();
      expect(body.receivedByQuintile).toEqual([]);
      expect(body.ledger).toEqual(dflt.ledger);
      expect(body.ledger.flows.length).toBeGreaterThan(0);
      expect(body).toMatchObject({ currency: 'zinthos', schemaVersion: 1, window: { from: RECV_BASE, to: RECV_BASE + 7 * DAY } });
    });

    it('balances=0 com from=0 (pedaço histórico) também funciona', async () => {
      const body = (await get(`/internal/economy/summary?from=0&to=${Date.now()}&balances=0`)).json();
      expect(body.balances).toBeNull();
      expect(body.ledger.flows.reduce((s: number, f: any) => s + f.count, 0)).toBe(26 + 3 + 12);
    });
  });

  describe('totalAtWindowEnd', () => {
    const summary = async (to: number) =>
      (await get(`/internal/economy/summary?from=${to - HOUR}&to=${to}`)).json().balances;

    it('total atual menos o extrato com createdAt >= to', async () => {
      // Nada no extrato depois de SPLIT_BASE + 1h: igual ao total.
      expect(await summary(SPLIT_BASE + HOUR)).toMatchObject({ total: 12750, totalAtWindowEnd: 12750 });
      // A partir de SPLIT_BASE: 100 + 100 − 50 + 30 + 20 + 5 + 6 + 7 + 8 + 9 + 10 + 11 = 256.
      expect(await summary(SPLIT_BASE)).toMatchObject({ total: 12750, totalAtWindowEnd: 12750 - 256 });
      // `to` é exclusivo: a linha em SPLIT_BASE + 1 fica antes do corte quando to = SPLIT_BASE + 2.
      expect((await summary(SPLIT_BASE + 2)).totalAtWindowEnd).toBe(12750 - 156);
    });

    it('linha do extrato depois de `to` é descontada; antes, não', async () => {
      const at = Date.now() - 5_000;
      const prisma = server.prisma;
      await prisma.user.update({ where: { id: hid(50) }, data: { kakera: { increment: 123 } } });
      const row = await prisma.kakeraTransaction.create({
        data: { userId: hid(50), amount: 123, reason: 'DAILY_REWARD', createdAt: new Date(at) },
      });
      try {
        expect(await summary(at)).toMatchObject({ total: 12873, totalAtWindowEnd: 12750 });
        expect(await summary(at + 1)).toMatchObject({ total: 12873, totalAtWindowEnd: 12873 });
      } finally {
        await prisma.kakeraTransaction.delete({ where: { id: row.id } });
        await prisma.user.update({ where: { id: hid(50) }, data: { kakera: { decrement: 123 } } });
      }
    });

    it('HOSTING_FEE_WAIFU depois de `to` não é descontado (nunca creditou o saldo)', async () => {
      const at = Date.now() - 5_000;
      const prisma = server.prisma;
      // Cobrança parcial: debita o saldo (com extrato) e registra o confisco (sem crédito no saldo).
      await prisma.user.update({ where: { id: hid(50) }, data: { kakera: { decrement: 40 } } });
      const rows = await Promise.all([
        prisma.kakeraTransaction.create({ data: { userId: hid(50), amount: -40, reason: 'HOSTING_FEE', createdAt: new Date(at) } }),
        prisma.kakeraTransaction.create({ data: { userId: hid(50), amount: 300, reason: 'HOSTING_FEE_WAIFU', createdAt: new Date(at) } }),
      ]);
      try {
        expect(await summary(at)).toMatchObject({ total: 12710, totalAtWindowEnd: 12750 });
      } finally {
        await prisma.kakeraTransaction.deleteMany({ where: { id: { in: rows.map((r: any) => r.id) } } });
        await prisma.user.update({ where: { id: hid(50) }, data: { kakera: { increment: 40 } } });
      }
    });

    it('mudança sem extrato (como o give-all) depois de `to` cai antes do corte', async () => {
      const prisma = server.prisma;
      await prisma.user.updateMany({ data: { kakera: { increment: 2 } } }); // 53 contas
      try {
        const b = await summary(SPLIT_BASE + HOUR);
        expect(b.total).toBe(12750 + 106);
        expect(b.totalAtWindowEnd).toBe(12750 + 106);
      } finally {
        await prisma.user.updateMany({ data: { kakera: { decrement: 2 } } });
      }
    });
  });

  describe('entradas por quinto', () => {
    it('soma e mediana só de motivos de criação, na janela, por faixa de saldo atual', async () => {
      const res = await get(`/internal/economy/summary?from=${RECV_BASE}&to=${RECV_BASE + 7 * DAY}&received=1`);
      expect(res.json().receivedByQuintile).toEqual([
        { q: 1, n: 10, receivedSum: 550, receivedMedian: 50 },
        { q: 2, n: 10, receivedSum: 20, receivedMedian: 0 },
        { q: 3, n: 10, receivedSum: 0, receivedMedian: 0 },
        { q: 4, n: 10, receivedSum: 0, receivedMedian: 0 },
        { q: 5, n: 10, receivedSum: 700, receivedMedian: 0 },
      ]);
    });

    it('é opt-in: sem received=1 (ou com received=0) vem [] mesmo em janela curta', async () => {
      for (const qs of ['', '&received=0']) {
        const res = await get(`/internal/economy/summary?from=${RECV_BASE}&to=${RECV_BASE + 7 * DAY}${qs}`);
        expect(res.statusCode).toBe(200);
        expect(res.json().receivedByQuintile).toEqual([]);
        expect(res.json().balances.quintiles).toHaveLength(5);
      }
    });

    it('janela de exatamente 8 dias ainda é calculada', async () => {
      const res = await get(`/internal/economy/summary?from=${RECV_BASE}&to=${RECV_BASE + 8 * DAY}&received=1`);
      const r = res.json().receivedByQuintile;
      expect(r).toHaveLength(5);
      expect(r[0].receivedSum).toBe(550 + 9999);
    });

    it('vem [] para janelas maiores que 8 dias (inclusive from=0)', async () => {
      const longer = await get(`/internal/economy/summary?from=${RECV_BASE}&to=${RECV_BASE + 8 * DAY + 1}&received=1`);
      expect(longer.statusCode).toBe(200);
      expect(longer.json().receivedByQuintile).toEqual([]);
      const full = await get(`/internal/economy/summary?from=0&to=${Date.now()}&received=1`);
      expect(full.json().receivedByQuintile).toEqual([]);
    });
  });

  describe('ciclo da alma gêmea (soulmateCycle)', () => {
    const H = SOUL_BASE;
    const MIN = 60_000;
    let ids: string[] = [];

    beforeAll(async () => {
      const prisma = server.prisma;
      const buy = (userId: string, amount: number, characterId: string, at: number, type = 'MARRIED_SHARE_PURCHASE') => ({
        userId,
        amount: -amount,
        reason: 'MARKET_BUY' as any,
        createdAt: new Date(at),
        metadata: { type, characterId, sharesBought: 1 },
      });
      const divorce = (userId: string, amount: number, characterId: string, at: number, isSoulmate: boolean) => ({
        userId,
        amount,
        reason: 'DIVORCE' as any,
        createdAt: new Date(at),
        metadata: { characterId, isSoulmate },
      });
      const data = [
        // h30 / soul_a: cotas 100 + 200 = 300 > pago 250. Compra de investimento e cota de outro personagem não contam.
        buy(hid(30), 100, 'soul_a', H - 2 * DAY),
        buy(hid(30), 200, 'soul_a', H - DAY),
        buy(hid(30), 999, 'soul_a', H - DAY, 'INVESTMENT_SHARE_PURCHASE'),
        buy(hid(30), 500, 'soul_b', H - DAY),
        divorce(hid(30), 250, 'soul_a', H + 10 * MIN, true),
        // h31 / soul_b: cotas 100 < pago 400 (retorno 4x).
        buy(hid(31), 100, 'soul_b', H - 3 * HOUR),
        divorce(hid(31), 400, 'soul_b', H + 20 * MIN, true),
        // h31 / soul_b, novo ciclo: só a cota comprada depois do divórcio anterior conta (50 < 60).
        buy(hid(31), 50, 'soul_b', H + 30 * MIN),
        divorce(hid(31), 60, 'soul_b', H + HOUR + 5 * MIN, true),
        // h32: divórcio que não é de alma gêmea é ignorado (mesmo com cotas).
        buy(hid(32), 100, 'soul_c', H - HOUR),
        divorce(hid(32), 30, 'soul_c', H + 15 * MIN, false),
        // h33: alma gêmea sem cotas compradas (custo 0: conta em withoutQuota, não em aboveCost nem no maxReturn).
        divorce(hid(33), 80, 'soul_d', H + HOUR + 10 * MIN, true),
        // h34: mesmo personagem de h30, mas as cotas de h30 não contam para outro jogador (também sem cotas).
        divorce(hid(34), 10, 'soul_a', H + HOUR + 20 * MIN, true),
        // h35 (hora H + 2h): pagou exatamente o custo das cotas: não está acima do custo.
        buy(hid(35), 70, 'soul_e', H + HOUR + 50 * MIN),
        divorce(hid(35), 70, 'soul_e', H + 2 * HOUR + 5 * MIN, true),
      ];
      const rows = await prisma.$transaction(data.map((d: any) => prisma.kakeraTransaction.create({ data: d })));
      ids = rows.map((r: any) => r.id);
    });

    afterAll(async () => {
      if (ids.length) await server.prisma.kakeraTransaction.deleteMany({ where: { id: { in: ids } } });
    });

    const hourH = { hour: H, divorces: 2, paid: 650, quotaCost: 400, aboveCost: 1, withoutQuota: 0, maxReturn: 4 };
    const hourH1 = { hour: H + HOUR, divorces: 3, paid: 150, quotaCost: 50, aboveCost: 1, withoutQuota: 2, maxReturn: 1.2 };

    it('agrega por hora: divórcios, pago, custo das cotas, acima do custo, sem cotas e maior retorno', async () => {
      const res = await get(`/internal/economy/summary?from=${H}&to=${H + 2 * HOUR}`);
      expect(res.statusCode).toBe(200);
      const cycle = res.json().soulmateCycle;
      expect(cycle).toHaveLength(2);
      expect(cycle[0]).toEqual({ ...hourH, maxReturn: expect.closeTo(4, 10) });
      expect(cycle[1]).toEqual({ ...hourH1, maxReturn: expect.closeTo(1.2, 10) });
    });

    it('pagar exatamente o custo das cotas não conta como acima do custo', async () => {
      const res = await get(`/internal/economy/summary?from=${H + 2 * HOUR}&to=${H + 3 * HOUR}&balances=0`);
      expect(res.json().soulmateCycle).toEqual([
        { hour: H + 2 * HOUR, divorces: 1, paid: 70, quotaCost: 70, aboveCost: 0, withoutQuota: 0, maxReturn: 1 },
      ]);
    });

    it('divórcio anterior fora da janela ainda limita o ciclo', async () => {
      const res = await get(`/internal/economy/summary?from=${H + HOUR}&to=${H + 2 * HOUR}`);
      const cycle = res.json().soulmateCycle;
      expect(cycle).toEqual([{ ...hourH1, maxReturn: expect.closeTo(1.2, 10) }]);
    });

    it('também vem com balances=0', async () => {
      const res = await get(`/internal/economy/summary?from=${H}&to=${H + 2 * HOUR}&balances=0`);
      expect(res.json().balances).toBeNull();
      expect(res.json().soulmateCycle).toHaveLength(2);
    });

    it('janela sem divórcio de alma gêmea: []', async () => {
      for (const qs of [`from=${FLOW_BASE}&to=${FLOW_BASE + 2 * HOUR}`, `from=${H - DAY}&to=${H}&balances=0`]) {
        const res = await get(`/internal/economy/summary?${qs}`);
        expect(res.statusCode).toBe(200);
        expect(res.json().soulmateCycle).toEqual([]);
      }
    });
  });

  describe('GET /internal/economy/players — recorte por jogador', () => {
    const players = (qs: string, headers?: Record<string, string>) => get(`/internal/economy/players?${qs}`, headers);

    describe('autenticação', () => {
      it('recusa sem Authorization e com chave errada (401)', async () => {
        const qs = `from=${FLOW_BASE}&to=${FLOW_BASE + HOUR}`;
        expect((await players(qs, {})).statusCode).toBe(401);
        expect((await players(qs, { authorization: 'Bearer chave_errada' })).statusCode).toBe(401);
      });

      it('autentica antes de validar os parâmetros (401, não 400)', async () => {
        const res = await players('from=abc', {});
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('validação (400)', () => {
      const now = Date.now();
      it.each([
        ['sem parâmetros', ''],
        ['sem to', `from=${FLOW_BASE}`],
        ['from não numérico', `from=abc&to=${FLOW_BASE}`],
        ['from fracionário', `from=1.5&to=${FLOW_BASE}`],
        ['from negativo', `from=-1&to=${FLOW_BASE}`],
      ])('%s', async (_label, qs) => {
        const res = await players(qs);
        expect(res.statusCode).toBe(400);
        expect(res.json().success).toBe(false);
      });

      it.each([
        ['to igual a from', `from=${FLOW_BASE}&to=${FLOW_BASE}`],
        ['to menor que from', `from=${FLOW_BASE}&to=${FLOW_BASE - 1}`],
        ['to além de agora + 60s', `from=${now - HOUR}&to=${now + 5 * 60_000}`],
        ['janela maior que 8 dias', `from=${RECV_BASE}&to=${RECV_BASE + 8 * DAY + 1}`],
        ['histórico inteiro (from=0)', `from=0&to=${now}`],
      ])('%s → INVALID_WINDOW', async (_label, qs) => {
        const res = await players(qs);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INVALID_WINDOW');
      });

      it('aceita janela de exatamente 8 dias e to até agora + 60s', async () => {
        expect((await players(`from=${RECV_BASE}&to=${RECV_BASE + 8 * DAY}`)).statusCode).toBe(200);
        expect((await players(`from=${Date.now() - HOUR}&to=${Date.now() + 30_000}`)).statusCode).toBe(200);
      });
    });

    it('forma da resposta e fluxos separados por jogador e motivo', async () => {
      const res = await players(`from=${FLOW_BASE}&to=${FLOW_BASE + 2 * HOUR}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        currency: 'zinthos',
        schemaVersion: 1,
        window: { from: FLOW_BASE, to: FLOW_BASE + 2 * HOUR },
        ledger: { available: true },
      });
      expect(typeof body.generatedAt).toBe('number');
      expect(body.flows).toEqual([
        { id: hid(1), reason: 'DAILY_REWARD', amountIn: 50, amountOut: 0, count: 1 },
        { id: hid(1), reason: 'HOSTING_FEE', amountIn: 0, amountOut: 40, count: 1 },
        { id: hid(25), reason: 'MARKET_TRADE', amountIn: 10, amountOut: 5, count: 2 },
        { id: hid(50), reason: 'DAILY_REWARD', amountIn: 120, amountOut: 0, count: 2 },
        { id: hid(50), reason: 'MARKET_BUY', amountIn: 0, amountOut: 30, count: 1 },
      ]);
      // As 50 contas com saldo entram (com ou sem extrato na janela); as zeradas sem extrato, não.
      const ids = body.players.map((p: any) => p.id);
      expect(ids).toHaveLength(50);
      expect(ids).toContain(hid(40));
      expect(ids.some((id: string) => id.startsWith('econ_zero_'))).toBe(false);
      expect(body.players.find((p: any) => p.id === hid(1))).toEqual({
        id: hid(1),
        name: 'Econ 1',
        platform: 'WHATSAPP',
        balance: 10,
        balanceAtWindowEnd: 10 - (1000 + 500 + (-20) + 9999 + 10),
        lastActiveAt: null,
      });
      // Só saldo, sem extrato em nenhum momento depois de `to`.
      expect(body.players.find((p: any) => p.id === hid(40))).toMatchObject({ balance: 400, balanceAtWindowEnd: 400 });
    });

    it('ADMIN_GRANT separado pela mesma chave de motivo do resumo', async () => {
      const body = (await players(`from=${SPLIT_BASE}&to=${SPLIT_BASE + HOUR}`)).json();
      const f = (id: string, reason: string, amountIn: number, amountOut: number, count: number) => ({
        id,
        reason,
        amountIn,
        amountOut,
        count,
      });
      const expected = [
        f(hid(20), 'ADMIN_GRANT:bank_withdraw_zinthos', 100, 0, 1),
        f(hid(21), 'ADMIN_GRANT:bank_withdraw_zinthos', 100, 0, 1),
        f(hid(20), 'ADMIN_GRANT:bank_deposit_runas', 0, 50, 1),
        f(hid(20), 'ADMIN_GRANT:slots_prize', 30, 0, 1),
        f(hid(20), 'ADMIN_GRANT:donor_bonus', 20, 0, 1),
        f(hid(20), 'ADMIN_GRANT', 11, 0, 2),
        f(hid(20), 'ADMIN_GRANT:other', 25, 0, 3),
        f(hid(20), `ADMIN_GRANT:${'a'.repeat(64)}`, 9, 0, 1),
        f(hid(20), 'DIVORCE', 11, 0, 1),
      ];
      expect(body.flows).toHaveLength(expected.length);
      expect(body.flows).toEqual(expect.arrayContaining(expected));
    });

    it('lastActiveAt em epoch ms', async () => {
      const at = Date.UTC(2026, 4, 2, 3, 4, 5, 678);
      await server.prisma.user.update({ where: { id: hid(10) }, data: { lastActiveAt: new Date(at) } });
      try {
        const body = (await players(`from=${FLOW_BASE}&to=${FLOW_BASE + HOUR}`)).json();
        expect(body.players.find((p: any) => p.id === hid(10)).lastActiveAt).toBe(at);
      } finally {
        await server.prisma.user.update({ where: { id: hid(10) }, data: { lastActiveAt: null } });
      }
    });

    it('balanceAtWindowEnd desconta o extrato depois de `to`, sem HOSTING_FEE_WAIFU; zerado com extrato entra', async () => {
      const at = Date.now() - 5_000;
      const prisma = server.prisma;
      await prisma.user.update({ where: { id: hid(50) }, data: { kakera: { increment: 123 - 40 } } });
      const rows = await prisma.$transaction([
        prisma.kakeraTransaction.create({ data: { userId: hid(50), amount: 123, reason: 'DAILY_REWARD', createdAt: new Date(at) } }),
        prisma.kakeraTransaction.create({ data: { userId: hid(50), amount: -40, reason: 'HOSTING_FEE', createdAt: new Date(at) } }),
        prisma.kakeraTransaction.create({ data: { userId: hid(50), amount: 300, reason: 'HOSTING_FEE_WAIFU', createdAt: new Date(at) } }),
        // Conta zerada que movimentou na janela (entrou e saiu): aparece com saldo 0.
        prisma.kakeraTransaction.create({ data: { userId: 'econ_zero_2', amount: 5, reason: 'DAILY_REWARD', createdAt: new Date(at) } }),
        prisma.kakeraTransaction.create({ data: { userId: 'econ_zero_2', amount: -5, reason: 'MARKET_BUY', createdAt: new Date(at) } }),
      ]);
      try {
        const before = (await players(`from=${at - HOUR}&to=${at}`)).json();
        expect(before.players.find((p: any) => p.id === hid(50))).toMatchObject({ balance: 583, balanceAtWindowEnd: 500 });
        expect(before.players.map((p: any) => p.id)).not.toContain('econ_zero_2');

        const after = (await players(`from=${at}&to=${at + 1}`)).json();
        expect(after.players.find((p: any) => p.id === hid(50))).toMatchObject({ balance: 583, balanceAtWindowEnd: 583 });
        expect(after.players.find((p: any) => p.id === 'econ_zero_2')).toMatchObject({ balance: 0, balanceAtWindowEnd: 0 });
        expect(after.players.map((p: any) => p.id)).not.toContain('econ_zero_1');
        expect(after.flows).toEqual([
          { id: hid(50), reason: 'DAILY_REWARD', amountIn: 123, amountOut: 0, count: 1 },
          { id: hid(50), reason: 'HOSTING_FEE', amountIn: 0, amountOut: 40, count: 1 },
          { id: hid(50), reason: 'HOSTING_FEE_WAIFU', amountIn: 300, amountOut: 0, count: 1 },
          { id: 'econ_zero_2', reason: 'DAILY_REWARD', amountIn: 5, amountOut: 0, count: 1 },
          { id: 'econ_zero_2', reason: 'MARKET_BUY', amountIn: 0, amountOut: 5, count: 1 },
        ]);
      } finally {
        await prisma.kakeraTransaction.deleteMany({ where: { id: { in: rows.map((r: any) => r.id) } } });
        await prisma.user.update({ where: { id: hid(50) }, data: { kakera: { decrement: 123 - 40 } } });
      }
    });

    it('quem tinha saldo no fim da janela, não movimentou nela e hoje está zerado continua no dia', async () => {
      // econ_zero_3 tem saldo 0 hoje, mas gastou 77 depois da janela: no fim dela tinha 77.
      const at = Date.UTC(2026, 5, 15, 12, 0, 0);
      const row = await server.prisma.kakeraTransaction.create({
        data: { userId: 'econ_zero_3', amount: -77, reason: 'MARKET_BUY', createdAt: new Date(at) },
      });
      try {
        const day = (await players(`from=${at - DAY}&to=${at - HOUR}`)).json();
        expect(day.players.find((p: any) => p.id === 'econ_zero_3')).toMatchObject({ balance: 0, balanceAtWindowEnd: 77 });
        expect(day.flows.some((f: any) => f.id === 'econ_zero_3')).toBe(false);
        // Depois do gasto, zerado e sem movimento: fica de fora.
        const later = (await players(`from=${at + HOUR}&to=${at + 2 * HOUR}`)).json();
        expect(later.players.map((p: any) => p.id)).not.toContain('econ_zero_3');
      } finally {
        await server.prisma.kakeraTransaction.delete({ where: { id: row.id } });
      }
    });

    it('somando os jogadores, os fluxos batem com ledger.flows do resumo na mesma janela', async () => {
      const byReason = (rows: any[]) => {
        const m: Record<string, { amountIn: number; amountOut: number; count: number }> = {};
        for (const r of rows) {
          const acc = (m[r.reason] ||= { amountIn: 0, amountOut: 0, count: 0 });
          acc.amountIn += r.amountIn;
          acc.amountOut += r.amountOut;
          acc.count += r.count;
        }
        return m;
      };
      for (const [from, to] of [
        [FLOW_BASE, FLOW_BASE + 2 * HOUR],
        [SPLIT_BASE, SPLIT_BASE + HOUR],
        [RECV_BASE, RECV_BASE + 8 * DAY],
      ]) {
        const summary = (await get(`/internal/economy/summary?from=${from}&to=${to}&balances=0`)).json();
        const perPlayer = (await players(`from=${from}&to=${to}`)).json();
        expect(Object.keys(byReason(summary.ledger.flows)).length).toBeGreaterThan(0);
        expect(byReason(perPlayer.flows)).toEqual(byReason(summary.ledger.flows));
        // Todo jogador com fluxo está em players.
        const ids = new Set(perPlayer.players.map((p: any) => p.id));
        for (const f of perPlayer.flows) expect(ids.has(f.id)).toBe(true);
      }
    });
  });

  describe('faixas pequenas (n < 10) saem preenchidas', () => {
    it('preenche min/max/sum e receivedSum/receivedMedian dos quintos com menos de 10 contas', async () => {
      // Zera 3 contas do 1º quinto: 47 holders → quintos de 10, 10, 9, 9, 9.
      await server.prisma.user.updateMany({ where: { id: { in: [hid(1), hid(2), hid(3)] } }, data: { kakera: 0 } });

      const res = await get(`/internal/economy/summary?from=${RECV_BASE}&to=${RECV_BASE + 7 * DAY}&received=1`);
      const { balances, receivedByQuintile } = res.json();
      expect(balances.holders).toBe(47);
      expect(balances.accounts).toBe(53);
      expect(balances.total).toBe(12750 - 60);
      expect(balances.quintiles).toEqual([
        { q: 1, n: 10, min: 40, max: 130, sum: 850 },
        { q: 2, n: 10, min: 140, max: 230, sum: 1850 },
        { q: 3, n: 9, min: 240, max: 320, sum: 2520 },
        { q: 4, n: 9, min: 330, max: 410, sum: 3330 },
        { q: 5, n: 9, min: 420, max: 500, sum: 4140 },
      ]);
      // h04..h10 continuam no 1º quinto (recebem 40..100); h11 (20 de criação) a h13 entram nele.
      // h50 (700 de DIVORCE) está no 5º quinto, de 9 contas.
      expect(receivedByQuintile).toEqual([
        { q: 1, n: 10, receivedSum: 510, receivedMedian: 50 },
        { q: 2, n: 10, receivedSum: 0, receivedMedian: 0 },
        { q: 3, n: 9, receivedSum: 0, receivedMedian: 0 },
        { q: 4, n: 9, receivedSum: 0, receivedMedian: 0 },
        { q: 5, n: 9, receivedSum: 700, receivedMedian: 0 },
      ]);
    });

    it('com poucos holders, os quintos com membros vêm preenchidos e os ausentes com n=0 e nulos', async () => {
      await server.prisma.user.updateMany({ where: { id: { notIn: [hid(49), hid(50)] } }, data: { kakera: 0 } });
      const res = await get(`/internal/economy/summary?from=${RECV_BASE}&to=${RECV_BASE + 7 * DAY}&received=1`);
      const { balances, receivedByQuintile } = res.json();
      expect(balances.holders).toBe(2);
      expect(balances.total).toBe(990);
      expect(balances.top10Share).toBeCloseTo(500 / 990, 10);
      expect(balances.quintiles).toEqual([
        { q: 1, n: 1, min: 490, max: 490, sum: 490 },
        { q: 2, n: 1, min: 500, max: 500, sum: 500 },
        { q: 3, n: 0, min: null, max: null, sum: null },
        { q: 4, n: 0, min: null, max: null, sum: null },
        { q: 5, n: 0, min: null, max: null, sum: null },
      ]);
      expect(receivedByQuintile).toEqual([
        { q: 1, n: 1, receivedSum: 0, receivedMedian: 0 },
        { q: 2, n: 1, receivedSum: 700, receivedMedian: 700 },
        { q: 3, n: 0, receivedSum: null, receivedMedian: null },
        { q: 4, n: 0, receivedSum: null, receivedMedian: null },
        { q: 5, n: 0, receivedSum: null, receivedMedian: null },
      ]);
    });
  });
});
