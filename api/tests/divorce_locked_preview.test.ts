import { describe, it, expect, beforeEach } from 'vitest';
import { DivorceService } from '../src/services/DivorceService.js';

describe('DivorceService - Preview de Divórcio Bloqueado e Integridade Mutativa', () => {
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      get: async () => null,
      set: async () => 'OK',
      exists: async () => 0,
      incr: async () => 1,
    };
  });

  it('previewDivorce deve retornar valor de reembolso e isLocked=true para personagem com isLocked=true sem lançar DomainError', async () => {
    const mockPrisma: any = {
      haremEntry: {
        findFirst: async () => ({
          id: 'entry_locked_1',
          userId: 'user_1',
          characterId: 'char_asuka',
          keys: 3,
          isLocked: true,
          collection: null,
          character: {
            id: 'char_asuka',
            name: 'Asuka Langley',
            baseRarity: 'EPIC',
            isMythic: false,
            rarityRank: 50,
          },
        }),
      },
      soulmate: {
        findUnique: async () => null,
      },
      character: {
        count: async () => 200,
      },
    };

    const divorceService = new DivorceService(mockPrisma, undefined, mockRedis);

    const preview = await divorceService.previewDivorce('user_1', 'char_asuka');

    expect(preview).toBeDefined();
    expect(preview.isLocked).toBe(true);
    expect(preview.lockReason).toContain('bloqueado contra divórcio');
    expect(preview.refundedKakera).toBeGreaterThan(0);
    expect(preview.character.id).toBe('char_asuka');
  });

  it('previewDivorce deve retornar isLocked=true quando a coleção do personagem estiver travada', async () => {
    const mockPrisma: any = {
      haremEntry: {
        findFirst: async () => ({
          id: 'entry_locked_col',
          userId: 'user_1',
          characterId: 'char_rei',
          keys: 1,
          isLocked: false,
          collection: {
            id: 'col_evangelion',
            name: 'Evangelion Set',
            isLocked: true,
          },
          character: {
            id: 'char_rei',
            name: 'Rei Ayanami',
            baseRarity: 'RARE',
            isMythic: false,
            rarityRank: 30,
          },
        }),
      },
      soulmate: {
        findUnique: async () => null,
      },
      character: {
        count: async () => 150,
      },
    };

    const divorceService = new DivorceService(mockPrisma, undefined, mockRedis);

    const preview = await divorceService.previewDivorce('user_1', 'char_rei');

    expect(preview).toBeDefined();
    expect(preview.isLocked).toBe(true);
    expect(preview.lockReason).toContain('Evangelion Set');
    expect(preview.refundedKakera).toBeGreaterThan(0);
  });

  it('previewDivorce deve retornar isLocked=false para personagem desbloqueado', async () => {
    const mockPrisma: any = {
      haremEntry: {
        findFirst: async () => ({
          id: 'entry_unlocked',
          userId: 'user_1',
          characterId: 'char_shinji',
          keys: 1,
          isLocked: false,
          collection: null,
          character: {
            id: 'char_shinji',
            name: 'Shinji Ikari',
            baseRarity: 'COMMON',
            isMythic: false,
            rarityRank: 10,
          },
        }),
      },
      soulmate: {
        findUnique: async () => null,
      },
      character: {
        count: async () => 500,
      },
    };

    const divorceService = new DivorceService(mockPrisma, undefined, mockRedis);

    const preview = await divorceService.previewDivorce('user_1', 'char_shinji');

    expect(preview).toBeDefined();
    expect(preview.isLocked).toBe(false);
    expect(preview.lockReason).toBeUndefined();
    expect(preview.refundedKakera).toBeGreaterThan(0);
  });

  it('divorce mutativo deve continuar bloqueando estritamente personagem travado', async () => {
    const mockPrisma: any = {
      haremEntry: {
        findFirst: async () => ({
          id: 'entry_locked_1',
          userId: 'user_1',
          characterId: 'char_asuka',
          keys: 3,
          isLocked: true,
          collection: null,
          character: {
            id: 'char_asuka',
            name: 'Asuka Langley',
            baseRarity: 'EPIC',
            isMythic: false,
          },
        }),
      },
    };

    const divorceService = new DivorceService(mockPrisma, undefined, mockRedis);

    const result = await divorceService.divorce('user_1', 'char_asuka');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CHARACTER_LOCKED');
  });

  it('divorce mutativo deve continuar bloqueando estritamente coleção travada', async () => {
    const mockPrisma: any = {
      haremEntry: {
        findFirst: async () => ({
          id: 'entry_locked_col',
          userId: 'user_1',
          characterId: 'char_rei',
          keys: 1,
          isLocked: false,
          collection: {
            id: 'col_evangelion',
            name: 'Evangelion Set',
            isLocked: true,
          },
          character: {
            id: 'char_rei',
            name: 'Rei Ayanami',
            baseRarity: 'RARE',
            isMythic: false,
          },
        }),
      },
    };

    const divorceService = new DivorceService(mockPrisma, undefined, mockRedis);

    const result = await divorceService.divorce('user_1', 'char_rei');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COLLECTION_LOCKED');
  });
});
