import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RollService } from '../src/services/RollService.js';
import { config } from '../src/config.js';

describe('Roll Scrap Reward Formula & Cap (Proposta A - 15% + Teto 150)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Validação Matemática da Equação e Teto', () => {
    it('deve respeitar a taxa reduzida (0.3) e o teto (150) configurados', () => {
      expect(config.ROLL_SCRAP_BONUS_FACTOR).toBe(0.3);
      expect(config.ROLL_SCRAP_BONUS_CAP).toBe(150);

      const calcBonus = (rolls: number) => {
        const raw = Math.floor(rolls * config.ROLL_SCRAP_BONUS_FACTOR);
        const capped = Math.min(config.ROLL_SCRAP_BONUS_CAP, raw);
        return { raw, capped, isCapped: raw > config.ROLL_SCRAP_BONUS_CAP };
      };

      // 0 rolls
      expect(calcBonus(0)).toEqual({ raw: 0, capped: 0, isCapped: false });

      // Jogador iniciante / Free (10 rolls)
      // Antigo: 10 * 2 = 20. Novo: floor(10 * 0.3) = 3
      expect(calcBonus(10)).toEqual({ raw: 3, capped: 3, isCapped: false });

      // Jogador intermediário (100 rolls acumulados)
      // Antigo: 100 * 2 = 200. Novo: floor(100 * 0.3) = 30
      expect(calcBonus(100)).toEqual({ raw: 30, capped: 30, isCapped: false });

      // Ponto de inflexão do teto (500 rolls)
      // 500 * 0.3 = 150
      expect(calcBonus(500)).toEqual({ raw: 150, capped: 150, isCapped: false });

      // Perfil Beowulf (600 rolls acumulados)
      // Antigo: 600 * 2 = 1.200 (+ wishlist = 2.400).
      // Novo: raw = 180, capped = 150
      expect(calcBonus(600)).toEqual({ raw: 180, capped: 150, isCapped: true });

      // Super acumulador (10.000 rolls acumulados)
      // Antigo: 10.000 * 2 = 20.000 (+ wishlist = 40.000).
      // Novo: raw = 3.000, capped = 150
      expect(calcBonus(10000)).toEqual({ raw: 3000, capped: 150, isCapped: true });
    });
  });

  describe('2. Integração no RollService', () => {
    it('deve aplicar o teto de 150 no scrapRollBonus e salvar nos metadados', async () => {
      const capturedTransactions: any[] = [];
      const updatedUsers: any[] = [];

      const testChar = {
        id: 'char_normal',
        numericId: 101,
        name: 'Normal Char',
        series: 'Anime',
        description: 'Desc',
        gender: 'FEMALE',
        baseRarity: 'COMMON',
        isMythic: false,
        mythicCustomization: null,
        imageUrls: ['img.jpg'],
        tags: [],
        claimCount: 0,
        _count: { wishlists: 0 },
        haremEntries: [],
      };

      const mockPrisma: any = {
        groupDisabledSeries: { findMany: vi.fn().mockResolvedValue([]) },
        wishlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
        characterInvestment: { findMany: vi.fn().mockResolvedValue([]) },
        character: {
          findMany: vi.fn().mockResolvedValue([testChar]),
          findUnique: vi.fn().mockResolvedValue(testChar),
          update: vi.fn().mockResolvedValue({}),
        },
        haremEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
        user: {
          update: vi.fn().mockImplementation((args) => {
            updatedUsers.push(args);
            return Promise.resolve(args);
          }),
        },
        kakeraTransaction: {
          create: vi.fn().mockImplementation((args) => {
            capturedTransactions.push(args);
            return Promise.resolve(args);
          }),
        },
        $transaction: vi.fn().mockImplementation(async (callback) => {
          if (typeof callback === 'function') {
            return callback(mockPrisma);
          }
          return callback;
        }),
      };

      const mockCooldown: any = {
        consumeRoll: vi.fn().mockResolvedValue({
          success: true,
          rollsState: {
            availableRolls: 800, // 800 rolls disponíveis
            maxRolls: 1000,
            secondsToNext: 0,
            fullRechargeSeconds: 0,
            fullRechargeAt: new Date(),
            regenSeconds: 300,
          },
        }),
        refundRoll: vi.fn().mockResolvedValue(undefined),
        getUserRolls: vi.fn().mockResolvedValue({
          availableRolls: 800,
          maxRolls: 1000,
          secondsToNext: 0,
          fullRechargeSeconds: 0,
          fullRechargeAt: new Date(),
          regenSeconds: 300,
        }),
        canMarryDaily: vi.fn().mockResolvedValue({ allowed: true }),
        getWeeklyLegendaryCount: vi.fn().mockResolvedValue(0),
        setClaimLock: vi.fn().mockResolvedValue(undefined),
      };

      const mockCharacterService: any = {
        getRandomImageUrl: vi.fn(() => 'img.jpg'),
        formatImageUrl: vi.fn((_, u) => u),
      };

      const service = new RollService(mockPrisma, mockCooldown, mockCharacterService);

      const result = await service.roll({
        userId: 'beowulf_test_id',
        groupId: 'test_group',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      // O bônus de roll deve estar limitado ao teto de 150 (raw seria 800 * 0.3 = 240)
      expect(result.data.rollReward.scrapRollBonus).toBe(150);

      // Metadados da transação criada
      expect(capturedTransactions.length).toBe(1);
      const txMeta = capturedTransactions[0].data.metadata;
      expect(txMeta.scrapRollBonus).toBe(150);
      expect(txMeta.scrapRollBonusRaw).toBe(240);
      expect(txMeta.scrapRollBonusCapped).toBe(true);
      expect(txMeta.availableRolls).toBe(800);

      // Total de Zinthos creditado deve refletir scrapRandom (10..25) + scrapRollBonus (150) + rarityBonus (0)
      const expectedBase = txMeta.scrapRandom + 150;
      expect(txMeta.baseScrap).toBe(expectedBase);
      expect(capturedTransactions[0].data.amount).toBe(expectedBase);
    });
  });
});
