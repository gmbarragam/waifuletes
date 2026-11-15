import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateWeeklyLegendaryMultiplier,
  calculateCharacterWeight,
  RARITY_BASE_WEIGHTS,
} from '../src/utils/rarityCalculator.js';
import { CooldownService, RARITY_CLAIM_COOLDOWNS } from '../src/services/CooldownService.js';
import { config } from '../src/config.js';

class MockRedis {
  private store = new Map<string, { val: string; expiresAt: number }>();

  async set(key: string, val: string, ...args: any[]): Promise<'OK' | null> {
    let ex = 0;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'EX') ex = Number(args[i + 1]);
      if (args[i] === 'NX') nx = true;
    }
    const existing = this.store.get(key);
    const now = Date.now();
    if (existing && existing.expiresAt > now) {
      if (nx) return null;
    }
    const expiresAt = ex > 0 ? now + ex * 1000 : Infinity;
    this.store.set(key, { val, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async eval(...args: any[]): Promise<any> {
    // Simula INCR_WITH_TTL_LUA
    const key = args[2];
    const delta = Number(args[3]);
    const ttl = Number(args[4]);
    const current = Number(this.store.get(key)?.val || 0);
    const nextVal = Math.max(0, current + delta);
    this.store.set(key, { val: String(nextVal), expiresAt: Date.now() + ttl * 1000 });
    return nextVal;
  }
}

describe('Weekly Legendary Diminishing Returns & Hard Cap System', () => {
  it('1. Cooldown de casamento com Lendárias deve ser de 6 horas (21600 segundos)', () => {
    expect(RARITY_CLAIM_COOLDOWNS.LEGENDARY).toBe(21600);
    expect(config.COOLDOWN_CLAIM_SECONDS_LEGENDARY).toBe(21600);
  });

  describe('2. Curva de Diminishing Returns e Hard Cap (calculateWeeklyLegendaryMultiplier)', () => {
    const hardCap = 8;

    it('deve manter 1.0 (100%) para 0 lendárias na semana', () => {
      expect(calculateWeeklyLegendaryMultiplier(0, hardCap)).toBe(1.0);
    });

    it('deve reduzir progressivamente a chance conforme lendárias são obtidas', () => {
      const mult1 = calculateWeeklyLegendaryMultiplier(1, hardCap);
      const mult2 = calculateWeeklyLegendaryMultiplier(2, hardCap);
      const mult3 = calculateWeeklyLegendaryMultiplier(3, hardCap);
      const mult4 = calculateWeeklyLegendaryMultiplier(4, hardCap);
      const mult5 = calculateWeeklyLegendaryMultiplier(5, hardCap);
      const mult6 = calculateWeeklyLegendaryMultiplier(6, hardCap);
      const mult7 = calculateWeeklyLegendaryMultiplier(7, hardCap);

      expect(mult1).toBeCloseTo(0.819, 2); // ~82%
      expect(mult2).toBeCloseTo(0.650, 2); // ~65%
      expect(mult3).toBeCloseTo(0.494, 2); // ~49%
      expect(mult4).toBeCloseTo(0.354, 2); // ~35%
      expect(mult5).toBeCloseTo(0.230, 2); // ~23%
      expect(mult6).toBeCloseTo(0.125, 2); // ~12.5%
      expect(mult7).toBeCloseTo(0.044, 2); // ~4.4%

      // Monotonicamente decrescente
      expect(mult1).toBeGreaterThan(mult2);
      expect(mult2).toBeGreaterThan(mult3);
      expect(mult3).toBeGreaterThan(mult4);
      expect(mult4).toBeGreaterThan(mult5);
      expect(mult5).toBeGreaterThan(mult6);
      expect(mult6).toBeGreaterThan(mult7);
    });

    it('deve zerar completamente a chance no hard cap de 8 lendárias (bloqueio total)', () => {
      expect(calculateWeeklyLegendaryMultiplier(8, hardCap)).toBe(0.0);
      expect(calculateWeeklyLegendaryMultiplier(9, hardCap)).toBe(0.0);
      expect(calculateWeeklyLegendaryMultiplier(29, hardCap)).toBe(0.0);
    });
  });

  describe('3. Impacto no Cálculo de Pesos (calculateCharacterWeight)', () => {
    it('deve zerar o peso de Lendário quando weeklyLegendaryMultiplier for 0', () => {
      const weight = calculateCharacterWeight({
        baseRarity: 'LEGENDARY',
        claimCount: 0,
        totalActiveUsersOrClaims: 1000,
        isWishlisted: true, // Mesmo na wishlist
        weeklyLegendaryMultiplier: 0,
      });
      expect(weight).toBe(0);
    });

    it('deve aplicar diminuição no peso quando weeklyLegendaryMultiplier for menor que 1', () => {
      const normalWeight = calculateCharacterWeight({
        baseRarity: 'LEGENDARY',
        claimCount: 0,
        totalActiveUsersOrClaims: 1000,
        isWishlisted: false,
        weeklyLegendaryMultiplier: 1.0,
      });

      const reducedWeight = calculateCharacterWeight({
        baseRarity: 'LEGENDARY',
        claimCount: 0,
        totalActiveUsersOrClaims: 1000,
        isWishlisted: false,
        weeklyLegendaryMultiplier: 0.5,
      });

      expect(normalWeight).toBe(3); // Math.round(2.5)
      expect(reducedWeight).toBe(1); // Math.round(2.5 * 0.5 = 1.25 -> 1)
      expect(reducedWeight).toBeLessThan(normalWeight);
    });

    it('não deve afetar outras raridades (ex: EPIC, RARE)', () => {
      const epicWeight = calculateCharacterWeight({
        baseRarity: 'EPIC',
        claimCount: 0,
        totalActiveUsersOrClaims: 1000,
        weeklyLegendaryMultiplier: 0, // Não afeta épicos
      });
      expect(epicWeight).toBe(RARITY_BASE_WEIGHTS.EPIC);
    });
  });

  describe('4. Ciclo Semanal e Contadores no Redis (CooldownService)', () => {
    let mockRedis: MockRedis;
    let service: CooldownService;

    beforeEach(() => {
      mockRedis = new MockRedis();
      service = new CooldownService(mockRedis as any);
    });

    it('deve calcular o próximo reset semanal para segunda-feira às 07:00 UTC (04:00 BRT)', () => {
      // Teste com uma quarta-feira
      const wednesday = new Date('2026-11-18T12:00:00Z');
      const cycle = service.getWeeklyCycleInfo(wednesday);

      // Próximo reset deve ser a próxima segunda-feira às 07:00 UTC
      expect(cycle.nextReset.getUTCDay()).toBe(1); // Monday
      expect(cycle.nextReset.getUTCHours()).toBe(7);
      expect(cycle.nextReset.toISOString()).toBe('2026-11-23T07:00:00.000Z');

      // Início do ciclo atual deve ser a segunda-feira anterior às 07:00 UTC
      expect(cycle.currentCycleStart.getUTCDay()).toBe(1);
      expect(cycle.currentCycleStart.toISOString()).toBe('2026-11-16T07:00:00.000Z');
    });

    it('deve gerenciar contadores semanais de lendárias no Redis com TTL', async () => {
      const userId = 'user_test_weekly_leg';

      // Inicialmente null no cache
      const initial = await service.getWeeklyLegendaryCount(userId);
      expect(initial).toBeNull();

      // Define contador manual (ex: hidratado do banco)
      await service.setWeeklyLegendaryCount(userId, 3);
      expect(await service.getWeeklyLegendaryCount(userId)).toBe(3);

      // Incrementa 1
      await service.incrementWeeklyLegendary(userId, 1);
      expect(await service.getWeeklyLegendaryCount(userId)).toBe(4);

      // Incrementa até atingir o cap
      await service.incrementWeeklyLegendary(userId, 4);
      expect(await service.getWeeklyLegendaryCount(userId)).toBe(8);
    });
  });
});
