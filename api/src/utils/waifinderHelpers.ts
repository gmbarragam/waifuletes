import { PrismaClient } from '@prisma/client';
import { config, ravenaMarketHeaders } from '../config.js';
import { DomainError } from '../errors/DomainError.js';
import { RollBonuses } from './rarityCalculator.js';

export interface RavenaRollContext {
  donorBonuses: RollBonuses | null;
  extraMaxRolls: number;
  farmRolls: number;
  farmTickets: number;
  eventRarosMult: number;
  eventWishMult: number;
}

export interface RavenaFarmReservation extends RavenaRollContext {
  reserved: boolean;
  type: 'ticket' | 'roll' | null;
  remainingRolls: number;
  remainingTickets: number;
}

function ravenaBaseUrl(): string {
  return (config.RAVENA_API_URL || 'http://172.22.0.1:5001').replace(/\/+$/, '');
}

/**
 * Consulta somente-leitura do contexto de rolls do usuário na Ravena (doador, fazenda e eventos).
 * Falha de rede retorna `null` para não bloquear o carregamento do catálogo no modo Olhando.
 */
export async function fetchRavenaRollContext(userId: string): Promise<RavenaRollContext | null> {
  try {
    const res = await fetch(`${ravenaBaseUrl()}/api/waifu/user-roll-context/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: ravenaMarketHeaders({ Accept: 'application/json' }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (!json?.success || !json?.data) return null;
    return {
      donorBonuses: json.data.donorBonuses || null,
      extraMaxRolls: Math.max(0, Number(json.data.extraMaxRolls) || 0),
      farmRolls: Math.max(0, Number(json.data.farmRolls) || 0),
      farmTickets: Math.max(0, Number(json.data.farmTickets) || 0),
      eventRarosMult: Number(json.data.eventRarosMult) || 1.0,
      eventWishMult: Number(json.data.eventWishMult) || 1.0,
    };
  } catch {
    return null;
  }
}

/**
 * Reserva atomicamente 1 bônus da fazenda (ticket ou roll) na Ravena e traz bônus/eventos.
 * Falha fechada (503) caso a Ravena esteja indisponível, evitando que o jogador perca
 * multiplicadores VIP ou queime saldo normal enquanto possui tickets da fazenda.
 */
export async function reserveRavenaFarmBonus(userId: string): Promise<RavenaFarmReservation> {
  try {
    const res = await fetch(`${ravenaBaseUrl()}/api/waifu/farm-bonus/reserve`, {
      method: 'POST',
      headers: ravenaMarketHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(4000),
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!res.ok || !json?.success || !json?.data) {
      throw new DomainError(
        'RAVENA_UNAVAILABLE',
        'Não foi possível validar seus bônus de fazenda/doador na Ravena no momento. Tente novamente em instantes.',
        503
      );
    }

    const d = json.data;
    const remainingRolls = Math.max(0, Number(d.remainingRolls) || 0);
    const remainingTickets = Math.max(0, Number(d.remainingTickets) || 0);

    return {
      reserved: Boolean(d.reserved),
      type: d.type === 'ticket' || d.type === 'roll' ? d.type : null,
      remainingRolls,
      remainingTickets,
      farmRolls: remainingRolls,
      farmTickets: remainingTickets,
      donorBonuses: d.donorBonuses || null,
      extraMaxRolls: Math.max(0, Number(d.extraMaxRolls) || 0),
      eventRarosMult: Number(d.eventRarosMult) || 1.0,
      eventWishMult: Number(d.eventWishMult) || 1.0,
    };
  } catch (err: any) {
    if (err instanceof DomainError) throw err;
    throw new DomainError(
      'RAVENA_UNAVAILABLE',
      'Não foi possível validar seus bônus de fazenda/doador na Ravena no momento. Tente novamente em instantes.',
      503
    );
  }
}

/**
 * Estorna 1 bônus da fazenda previamente reservado (em caso de erro ou personagem Mítico).
 */
export async function refundRavenaFarmBonus(userId: string, type: 'ticket' | 'roll'): Promise<boolean> {
  try {
    const res = await fetch(`${ravenaBaseUrl()}/api/waifu/farm-bonus/refund`, {
      method: 'POST',
      headers: ravenaMarketHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ userId, type }),
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json().catch(() => null)) as any;
    return Boolean(res.ok && json?.success && json?.refunded);
  } catch (err: any) {
    console.error(`[Waifinder] Falha ao estornar bônus da fazenda (${type}) para ${userId}:`, err?.message || err);
    return false;
  }
}

/**
 * Notifica nos canais de avisos da Ravena um casamento Lendário obtido pelo Waifinder.
 */
export function notifyRavenaLegendaryMarriage(params: {
  character: {
    id: string;
    name: string;
    series: string;
    rarity: string;
    imageUrl?: string | null;
  };
  userName: string;
}): void {
  fetch(`${ravenaBaseUrl()}/api/market/notify-legendary-marriage`, {
    method: 'POST',
    headers: ravenaMarketHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      character: params.character,
      userName: params.userName,
      acquisitionType: 'waifinder',
    }),
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    console.error('[Waifinder] Falha ao notificar casamento lendário na Ravena:', err?.message || err);
  });
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Monta os bônus de um único roll no Waifinder espelhando exatamente `buildStepRollBonuses`
 * + `sanitizeRollBonuses` do bot Ravena AI.
 */
export function buildWaifinderStepBonuses(params: {
  donorBonuses: RollBonuses | null;
  farmReservedType: 'ticket' | 'roll' | null;
  eventRarosMult?: number;
  eventWishMult?: number;
}): RollBonuses | undefined {
  const {
    donorBonuses,
    farmReservedType,
    eventRarosMult = 1.0,
    eventWishMult = 1.0,
  } = params;

  const hasFarm = farmReservedType === 'roll' || farmReservedType === 'ticket';
  const hasEvents = eventRarosMult !== 1.0 || eventWishMult !== 1.0;

  if (!donorBonuses && !hasFarm && !hasEvents) {
    return undefined;
  }

  const bonuses: RollBonuses = donorBonuses ? { ...donorBonuses } : {};
  if (bonuses.rarityMultipliers) {
    bonuses.rarityMultipliers = { ...bonuses.rarityMultipliers };
  }

  if (hasFarm) {
    bonuses.isFreeRoll = true;
    if (farmReservedType === 'ticket') {
      const cur = bonuses.rarityMultipliers
        ? { ...bonuses.rarityMultipliers }
        : { RARE: 1.0, EPIC: 1.0, LEGENDARY: 1.0 };
      cur.RARE = Math.max(cur.RARE || 1.0, 1.4);
      cur.EPIC = Math.max(cur.EPIC || 1.0, 1.7);
      cur.LEGENDARY = Math.max(cur.LEGENDARY || 1.0, 2.0);
      bonuses.rarityMultipliers = cur;
    }
  }

  if (hasEvents) {
    const cur = bonuses.rarityMultipliers
      ? { ...bonuses.rarityMultipliers }
      : { RARE: 1.0, EPIC: 1.0, LEGENDARY: 1.0 };

    if (eventRarosMult !== 1.0) {
      cur.RARE = Number(((cur.RARE || 1.0) * eventRarosMult).toFixed(3));
      cur.EPIC = Number(((cur.EPIC || 1.0) * eventRarosMult).toFixed(3));
      cur.LEGENDARY = Number(((cur.LEGENDARY || 1.0) * eventRarosMult).toFixed(3));
    }
    bonuses.rarityMultipliers = cur;

    if (eventWishMult !== 1.0) {
      const baseWish = bonuses.wishlistMultiplier || 1.0;
      bonuses.wishlistMultiplier = Math.min(20.0, Number((baseWish * eventWishMult).toFixed(3)));
    }
  }

  // Sanitização equivalente ao schema do /roll privado
  if (bonuses.rarityMultipliers) {
    for (const k of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const) {
      const v = bonuses.rarityMultipliers[k];
      if (typeof v === 'number' && !isNaN(v)) {
        bonuses.rarityMultipliers[k] = Number(clamp(v, 0.1, 10.0).toFixed(3));
      }
    }
  }
  if (typeof bonuses.wishlistMultiplier === 'number' && !isNaN(bonuses.wishlistMultiplier)) {
    bonuses.wishlistMultiplier = Number(clamp(bonuses.wishlistMultiplier, 0.1, 100.0).toFixed(3));
  }
  if (typeof bonuses.starWishMultiplier === 'number' && !isNaN(bonuses.starWishMultiplier)) {
    bonuses.starWishMultiplier = Number(clamp(bonuses.starWishMultiplier, 0.1, 10.0).toFixed(3));
  }
  if (typeof bonuses.extraMaxRolls === 'number' && !isNaN(bonuses.extraMaxRolls)) {
    bonuses.extraMaxRolls = clamp(Math.round(bonuses.extraMaxRolls), 0, 500);
  }

  return bonuses;
}

const VIRTUAL_GROUPS = new Set(['WAIFINDER', 'ROLL_COTA', 'admin', 'waifinder']);

/**
 * Resolve o grupo real mais recente do jogador para gravar em `harem_entries.claimedInGroup`,
 * com fallback para 'WAIFINDER'.
 */
export async function resolveUserLatestGroupId(prisma: PrismaClient, userId: string): Promise<string> {
  const recentEntry = await prisma.haremEntry.findFirst({
    where: {
      userId,
      claimedInGroup: { notIn: [userId, ...VIRTUAL_GROUPS] },
    },
    orderBy: { claimedAt: 'desc' },
    select: { claimedInGroup: true },
  });

  if (recentEntry?.claimedInGroup && !recentEntry.claimedInGroup.startsWith('waifinder:')) {
    return recentEntry.claimedInGroup;
  }

  const recentGroup = await prisma.userGroup.findFirst({
    where: {
      userId,
      groupId: { notIn: [userId, ...VIRTUAL_GROUPS] },
    },
    orderBy: { joinedAt: 'desc' },
    select: { groupId: true },
  });

  if (recentGroup?.groupId && !recentGroup.groupId.startsWith('waifinder:')) {
    return recentGroup.groupId;
  }

  return 'WAIFINDER';
}
