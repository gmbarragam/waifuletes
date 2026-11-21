import { describe, it, expect, vi, beforeEach } from 'vitest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

import { config } from '../src/config.js';

if (config.DATABASE_URL?.includes('postgres:5432')) {
  config.DATABASE_URL = config.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (config.REDIS_URL?.includes('redis:6379')) {
  config.REDIS_URL = config.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}
if (process.env.DATABASE_URL?.includes('postgres:5432')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('postgres:5432', '127.0.0.1:5433');
}
if (process.env.REDIS_URL?.includes('redis:6379')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis:6379', '127.0.0.1:6380');
}

import { RollService } from '../src/services/RollService.js';
import { CharacterService } from '../src/services/CharacterService.js';

describe('RollService - Exclusão de Personagens em Multi-Rolls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createChar = (id: string, name: string) => ({
    id,
    numericId: parseInt(id.replace(/\D/g, '') || '1', 10),
    name,
    series: 'Anime Series',
    description: 'Desc',
    gender: 'FEMALE' as const,
    baseRarity: 'COMMON' as const,
    isMythic: false,
    mythicCustomization: null,
    imageUrls: ['img.jpg'],
    tags: [],
    claimCount: 0,
    _count: { wishlists: 0 },
    haremEntries: [],
  });

  const chars = [
    createChar('char_1', 'Personagem 1'),
    createChar('char_2', 'Personagem 2'),
    createChar('char_3', 'Personagem 3'),
    createChar('char_4', 'Personagem 4'),
    createChar('char_5', 'Personagem 5'),
  ];

  const charMap = new Map(chars.map((c) => [c.id, c]));

  const mockPrisma: any = {
    groupDisabledSeries: { findMany: vi.fn().mockResolvedValue([]) },
    wishlistEntry: { findMany: vi.fn().mockResolvedValue([]) },
    characterInvestment: { findMany: vi.fn().mockResolvedValue([]) },
    character: {
      findMany: vi.fn().mockResolvedValue(chars),
      findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(charMap.get(where.id) || null)),
      update: vi.fn().mockResolvedValue({}),
    },
    haremEntry: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      update: vi.fn().mockResolvedValue({}),
    },
    kakeraTransaction: {
      create: vi.fn().mockResolvedValue({}),
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
        availableRolls: 10,
        maxRolls: 10,
        secondsToNext: 0,
        fullRechargeSeconds: 0,
        fullRechargeAt: null,
      },
    }),
    refundRoll: vi.fn().mockResolvedValue(undefined),
    getUserRolls: vi.fn().mockResolvedValue({
      availableRolls: 10,
      maxRolls: 10,
      secondsToNext: 0,
      fullRechargeSeconds: 0,
      fullRechargeAt: null,
    }),
    canMarryDaily: vi.fn().mockResolvedValue({ allowed: true }),
    getWeeklyLegendaryCount: vi.fn().mockResolvedValue(0),
    setWeeklyLegendaryCount: vi.fn().mockResolvedValue(true),
    getWeeklyCycleInfo: vi.fn().mockReturnValue({ currentCycleStart: new Date() }),
    setClaimLock: vi.fn().mockResolvedValue(undefined),
  };

  const mockCharacterService: any = {
    getRandomImageUrl: vi.fn(() => 'img.jpg'),
    formatImageUrl: vi.fn((_, u) => u),
  };

  it('não deve sortear um personagem presente em excludeCharacterIds', async () => {
    const rollService = new RollService(mockPrisma, mockCooldown, mockCharacterService);
    await rollService.loadPool();

    // Exclui char_1, char_2, char_3, char_4 -> deve obrigatoriamente retornar char_5
    const result = await rollService.roll({
      userId: 'test_user_excl',
      groupId: 'test_group_excl',
      excludeCharacterIds: ['char_1', 'char_2', 'char_3', 'char_4'],
    });

    expect(result.success).toBe(true);
    expect(result.data?.character.id).toBe('char_5');
  });

  it('deve simular um multi-roll sequencial acumulando exclusões sem repetir personagens', async () => {
    const rollService = new RollService(mockPrisma, mockCooldown, mockCharacterService);
    await rollService.loadPool();

    const rolledIds: string[] = [];

    for (let i = 0; i < 5; i++) {
      const res = await rollService.roll({
        userId: 'test_user_multi',
        groupId: 'test_group_multi',
        excludeCharacterIds: [...rolledIds],
      });

      expect(res.success).toBe(true);
      const chosenId = res.data!.character.id;
      expect(rolledIds).not.toContain(chosenId);
      rolledIds.push(chosenId);
    }

    expect(rolledIds).toHaveLength(5);
    const uniqueIds = new Set(rolledIds);
    expect(uniqueIds.size).toBe(5);
  });

  it('deve fazer fallback seguro caso todos os candidatos estejam na lista de exclusão', async () => {
    const rollService = new RollService(mockPrisma, mockCooldown, mockCharacterService);
    await rollService.loadPool();

    // Exclui todos os 5 personagens disponíveis
    const result = await rollService.roll({
      userId: 'test_user_fallback',
      groupId: 'test_group_fallback',
      excludeCharacterIds: ['char_1', 'char_2', 'char_3', 'char_4', 'char_5'],
    });

    expect(result.success).toBe(true);
    expect(['char_1', 'char_2', 'char_3', 'char_4', 'char_5']).toContain(result.data?.character.id);
  });

  it('deve aceitar excludeCharacterIds no schema HTTP da rota POST /roll sem erro de validação', async () => {
    const { buildServer } = await import('../src/server.js');
    const server = await buildServer();
    await server.ready();

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/roll',
        headers: {
          authorization: `Bearer ${process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '')}`,
        },
        payload: {
          userId: 'test_user_route',
          groupId: 'test_group_route',
          excludeCharacterIds: ['char_abc_1', 'char_abc_2'],
        },
      });

      // Não pode retornar 400 por erro de validação de schema (ex: "body must NOT have additional properties")
      expect(response.statusCode).not.toBe(400);
    } finally {
      // Limpeza estrita de dados de teste (GEMINI.md regra 7.2)
      try {
        await server.prisma.haremEntry.deleteMany({ where: { userId: 'test_user_route' } });
        await server.prisma.user.deleteMany({ where: { id: 'test_user_route' } });
        await server.prisma.group.deleteMany({ where: { id: 'test_group_route' } });
      } catch (_) {}
      await server.close();
    }
  });
});
