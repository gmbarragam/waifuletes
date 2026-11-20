import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterService } from '../src/services/CharacterService.js';

describe('🔍 Desambiguação de IDs Numéricos vs numericId (ex: "707" vs George Banks #707)', () => {
  const char707 = {
    id: '707',
    numericId: 12345,
    name: '707',
    series: 'Mystic Messenger',
    description: 'Hacker genial da RFA.',
    baseRarity: 'EPIC',
    gender: 'MALE',
    imageUrls: ['characters/707/default.jpg'],
    claimCount: 5,
    likeCount: 20,
    popularityScore: 150,
    isActive: true,
    haremEntries: [],
    _count: { haremEntries: 1, wishlists: 10, soulmates: 0 },
    creatorUser: null,
  };

  const charGeorgeBanks = {
    id: 'george-banks',
    numericId: 707,
    name: 'George Banks',
    series: 'Mary Poppins',
    description: 'Pai bancário sério.',
    baseRarity: 'COMMON',
    gender: 'MALE',
    imageUrls: ['characters/george-banks/default.jpg'],
    claimCount: 0,
    likeCount: 0,
    popularityScore: 5,
    isActive: true,
    haremEntries: [],
    _count: { haremEntries: 0, wishlists: 0, soulmates: 0 },
    creatorUser: null,
  };

  let mockPrisma: any;
  let service: CharacterService;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockPrisma = {
      character: {
        findUnique: vi.fn(async (args: any) => {
          if (args.where?.id === '707') return char707;
          if (args.where?.id === 'george-banks') return charGeorgeBanks;
          if (args.where?.numericId === 707) return charGeorgeBanks;
          if (args.where?.numericId === 12345) return char707;
          return null;
        }),
        findFirst: vi.fn(async () => null),
      },
      kakeraTransaction: {
        findFirst: vi.fn(async () => null),
      },
    };

    service = new CharacterService(mockPrisma);
  });

  describe('findCharacter', () => {
    it('deve priorizar a chave primária id ("707") em vez do numericId 707 de outro personagem', async () => {
      const result = await service.findCharacter('707');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('707');
      expect(result?.name).toBe('707');
      expect(result?.series).toBe('Mystic Messenger');
      expect(result?.numericId).toBe(12345);
    });

    it('deve resolver George Banks pelo slug/id "george-banks"', async () => {
      const result = await service.findCharacter('george-banks');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('george-banks');
      expect(result?.name).toBe('George Banks');
      expect(result?.numericId).toBe(707);
    });

    it('deve buscar por numericId quando não houver colisão com chave primária id existente', async () => {
      // 12345 não é id de ninguém, deve resolver para 707 via numericId
      const result = await service.findCharacter('12345');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('707');
      expect(result?.name).toBe('707');
    });
  });

  describe('getCharacterById', () => {
    it('deve retornar o personagem 707 (Mystic Messenger) ao consultar "707", e não George Banks', async () => {
      const result = await service.getCharacterById('707');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('707');
      expect(result?.name).toBe('707');
      expect(result?.series).toBe('Mystic Messenger');
    });

    it('deve retornar George Banks ao consultar "george-banks"', async () => {
      const result = await service.getCharacterById('george-banks');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('george-banks');
      expect(result?.name).toBe('George Banks');
    });

    it('deve resolver por numericId quando o ID informado for numérico mas não corresponder a nenhuma chave primária', async () => {
      const result = await service.getCharacterById('12345');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('707');
      expect(result?.name).toBe('707');
    });
  });
});
