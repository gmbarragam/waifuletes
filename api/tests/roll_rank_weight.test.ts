import { describe, it, expect } from 'vitest';
import { calculateRollRankWeight, calculateCharacterWeight } from '../src/utils/rarityCalculator.js';

describe('Algoritmo de Roll - Ponderação Inversa por Rank', () => {
  describe('Função calculateRollRankWeight', () => {
    it('deve retornar 1.0 para rank 1 (dificuldade máxima)', () => {
      expect(calculateRollRankWeight(1, 7.0, 20000)).toBe(1.0);
    });

    it('deve retornar 7.0 para rank 20000 (corte base de popularidade)', () => {
      expect(calculateRollRankWeight(20000, 7.0, 20000)).toBe(7.0);
    });

    it('deve interpolar linearmente para rank intermediário', () => {
      // (10000.5 - 1) / (20000 - 1) = 9999.5 / 19999 = 0.5
      // 1.0 + 6.0 * 0.5 = 4.0
      const weightMid = calculateRollRankWeight(10000.5, 7.0, 20000);
      expect(weightMid).toBeCloseTo(4.0, 2);
    });

    it('deve retornar 7.0 para ranks superiores ao corte (> 20000)', () => {
      expect(calculateRollRankWeight(25000, 7.0, 20000)).toBe(7.0);
      expect(calculateRollRankWeight(100000, 7.0, 20000)).toBe(7.0);
    });

    it('deve retornar 7.0 para null, undefined e valores sem rank', () => {
      expect(calculateRollRankWeight(null, 7.0, 20000)).toBe(7.0);
      expect(calculateRollRankWeight(undefined, 7.0, 20000)).toBe(7.0);
    });

    it('deve retornar 1.0 para ranks <= 1', () => {
      expect(calculateRollRankWeight(0, 7.0, 20000)).toBe(1.0);
      expect(calculateRollRankWeight(-10, 7.0, 20000)).toBe(1.0);
    });
  });

  describe('calculateCharacterWeight com rollRankWeight', () => {
    it('deve reduzir o peso do personagem proporcionalmente ao fator de rank', () => {
      const baseParams = {
        baseRarity: 'RARE' as const,
        claimCount: 0,
        totalActiveUsersOrClaims: 100,
        isWishlisted: true,
      };

      const normalWeight = calculateCharacterWeight(baseParams);
      // Com rollRankWeight de rank 1 (1.0 / 7.0 ≈ 0.142857)
      const rank1Weight = calculateCharacterWeight({
        ...baseParams,
        rollRankWeight: 1.0 / 7.0,
      });

      expect(rank1Weight).toBeLessThan(normalWeight);
      expect(rank1Weight).toBe(Math.max(1, Math.round(normalWeight * (1.0 / 7.0))));
    });
  });

  describe('Simulação Estatística de Rejection Sampling', () => {
    it('deve sortear o rank 20000 aproximadamente 7x mais frequentemente que o rank 1', () => {
      const candidates = [
        { id: 'rank_1', rankWeight: 1.0 },
        { id: 'rank_20k', rankWeight: 7.0 },
      ];
      const maxDiff = 7.0;

      const counts: Record<string, number> = { rank_1: 0, rank_20k: 0 };
      const totalDraws = 100_000;

      for (let i = 0; i < totalDraws; i++) {
        while (true) {
          const candidate = candidates[Math.floor(Math.random() * candidates.length)];
          if (Math.random() * maxDiff <= candidate.rankWeight) {
            counts[candidate.id]++;
            break;
          }
        }
      }

      const ratio = counts.rank_20k / counts.rank_1;
      // Proporção teórica: 7.0 / 1.0 = 7.0.
      // Com 100.000 amostras, o intervalo de confiança de 99% fica confortavelmente dentro de 6.3 a 7.7 (+- 10%).
      expect(ratio).toBeGreaterThan(6.2);
      expect(ratio).toBeLessThan(7.8);
    });
  });
});
