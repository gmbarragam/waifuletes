import { PrismaClient, KakeraReason } from '@prisma/client';
import { CooldownService } from './CooldownService.js';
import { config } from '../config.js';
import { DomainError } from '../errors/DomainError.js';

/** Dias máximos da sequência do daily (a partir daí o bônus fica no do último dia). */
export const DAILY_STREAK_MAX_DAYS = 7;

/** Bônus percentual do daily por dia de sequência (dia 1: 0%, ..., dia 7: 100%). */
export const DAILY_STREAK_BONUS_PERCENT: Record<number, number> = {
  1: 0,
  2: 10,
  3: 20,
  4: 30,
  5: 40,
  6: 50,
  7: 100,
};

/** Piso do valor base do daily (depois da variância). */
export const DAILY_MIN_BASE_AMOUNT = 100;

/** Bônus da wishlist no daily: cada item soma base / WISHLIST_DAILY_BONUS_DIVISOR (+0,1% por item). */
export const WISHLIST_DAILY_BONUS_DIVISOR = 1000;

/** Teto do multiplicador da wishlist informado na resposta do daily (2x com 1000 itens). */
export const WISHLIST_DAILY_MULTIPLIER_CAP = 2.0;

export class KakeraService {
  constructor(
    private prisma: PrismaClient,
    private cooldownService: CooldownService
  ) {}

  async claimDaily(userId: string) {
    const cycleInfo = this.cooldownService.getDailyCycleInfo();

    // 1. Reserva atômica do cooldown diário no Redis com SET ... NX até as 04:00
    const lockAcquired = await this.cooldownService.acquireDailyLock(userId, cycleInfo.secondsUntilReset);
    if (!lockAcquired) {
      const cooldown = await this.cooldownService.getDailyCooldown(userId);
      const hours = Math.floor(cooldown.remainingSeconds / 3600);
      const mins = Math.ceil((cooldown.remainingSeconds % 3600) / 60);
      return {
        success: false,
        error: {
          code: 'DAILY_COOLDOWN_ACTIVE',
          message: `Você já resgatou sua recompensa diária hoje! O próximo resgate reseta às 04:00 (em ${hours > 0 ? `${hours}h ` : ''}${mins}min).`,
          remainingSeconds: cooldown.remainingSeconds,
          retryAfter: cooldown.retryAfter || cycleInfo.nextReset,
        },
      };
    }

    // 2. Consulta última transação de recompensa diária para calcular streak e double-check de segurança
    const lastDailyTx = await this.prisma.kakeraTransaction.findFirst({
      where: { userId, reason: 'DAILY_REWARD' },
      orderBy: { createdAt: 'desc' },
    });

    // Se o banco já tiver transação no ciclo atual (ex: caso o Redis tenha sido resetado), bloqueia e restaura cooldown
    if (lastDailyTx && new Date(lastDailyTx.createdAt).getTime() >= cycleInfo.currentCycleStart.getTime()) {
      await this.cooldownService.setDailyCooldown(userId, cycleInfo.secondsUntilReset);
      const cooldown = await this.cooldownService.getDailyCooldown(userId);
      const hours = Math.floor(cooldown.remainingSeconds / 3600);
      const mins = Math.ceil((cooldown.remainingSeconds % 3600) / 60);
      return {
        success: false,
        error: {
          code: 'DAILY_COOLDOWN_ACTIVE',
          message: `Você já resgatou sua recompensa diária hoje! O próximo resgate reseta às 04:00 (em ${hours > 0 ? `${hours}h ` : ''}${mins}min).`,
          remainingSeconds: cooldown.remainingSeconds,
          retryAfter: cooldown.retryAfter || cycleInfo.nextReset,
        },
      };
    }

    let currentStreak = 1;
    if (lastDailyTx) {
      const txTime = new Date(lastDailyTx.createdAt).getTime();
      // Sequência válida: coletou no ciclo imediatamente anterior (entre previousCycleStart e currentCycleStart)
      if (txTime >= cycleInfo.previousCycleStart.getTime() && txTime < cycleInfo.currentCycleStart.getTime()) {
        const prevMetadata = lastDailyTx.metadata as any;
        const prevStreak = typeof prevMetadata?.streak === 'number' ? prevMetadata.streak : 1;
        currentStreak = Math.min(DAILY_STREAK_MAX_DAYS, prevStreak + 1);
      } else {
        currentStreak = 1;
      }
    }

    // Bônus percentual por dia de sequência (DAILY_STREAK_BONUS_PERCENT)
    const bonusPercent = DAILY_STREAK_BONUS_PERCENT[currentStreak] ?? 0;

    // Calcula recompensa diária com variância, bônus de streak e bônus da wishlist
    const variance = (Math.random() * 2 - 1) * config.DAILY_KAKERA_VARIANCE;
    const baseAmount = Math.max(DAILY_MIN_BASE_AMOUNT, Math.round(config.DAILY_KAKERA_AMOUNT + variance));
    const streakBonusAmount = Math.round(baseAmount * (bonusPercent / 100));

    // Bônus proporcional da Wishlist: cada item na wishlist adiciona 1/1000 (+0.1%), dobrando o valor ao atingir 1000 itens (2.0x)
    const wishlistCount = await this.prisma.wishlistEntry.count({ where: { userId } });
    const wishlistMultiplier = Math.min(WISHLIST_DAILY_MULTIPLIER_CAP, 1 + wishlistCount / WISHLIST_DAILY_BONUS_DIVISOR);
    const wishlistBonusAmount = Math.round(baseAmount * (wishlistCount / WISHLIST_DAILY_BONUS_DIVISOR));

    const amount = baseAmount + streakBonusAmount + wishlistBonusAmount;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            kakera: { increment: amount },
          },
        });

        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount,
            reason: 'DAILY_REWARD',
            metadata: {
              streak: currentStreak,
              baseAmount,
              streakBonusAmount,
              bonusPercent,
              wishlistCount,
              wishlistMultiplier,
              wishlistBonusAmount,
            },
          },
        });

        return updatedUser;
      });

      const nextDailyAt = cycleInfo.nextReset;

      let msg = currentStreak > 1
        ? `Você recebeu ${amount} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! 🔥 Sequência Diária: Dia ${currentStreak}/${DAILY_STREAK_MAX_DAYS} (+${bonusPercent}% bônus)!`
        : `Você recebeu ${amount} ${config.CURRENCY_NAME} ${config.CURRENCY_EMOJI}! Volte amanhã após as 04:00 para manter sua sequência!`;

      if (wishlistBonusAmount > 0) {
        msg += ` 🌟 (+${wishlistBonusAmount} de Bônus Wishlist: ${wishlistCount}/${WISHLIST_DAILY_BONUS_DIVISOR})`;
      }

      return {
        success: true,
        data: {
          amount,
          baseAmount,
          streak: {
            current: currentStreak,
            bonusPercent,
            bonusAmount: streakBonusAmount,
            maxStreak: DAILY_STREAK_MAX_DAYS,
          },
          wishlist: {
            count: wishlistCount,
            bonusAmount: wishlistBonusAmount,
            multiplier: wishlistMultiplier,
          },
          currency: config.CURRENCY_NAME,
          currencyEmoji: config.CURRENCY_EMOJI,
          newBalance: result.kakera,
          nextDailyAt,
          message: msg,
        },
      };
    } catch (err) {
      // Em caso de falha na persistência, estorna o lock de cooldown diário
      await this.cooldownService.resetCooldown(userId, 'daily');
      throw err;
    }
  }

  async getBalance(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        kakera: true,
      },
    });

    if (!user) return null;

    return {
      userId: user.id,
      name: user.name,
      balance: user.kakera,
      currency: config.CURRENCY_NAME,
      currencyEmoji: config.CURRENCY_EMOJI,
    };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [total, transactions] = await Promise.all([
      this.prisma.kakeraTransaction.count({ where: { userId } }),
      this.prisma.kakeraTransaction.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: transactions,
    };
  }

  async adminModifyKakera(params: {
    userId: string;
    amount: number;
    reason: KakeraReason;
    metadata?: any;
  }) {
    const { userId, amount, reason, metadata } = params;

    let user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      if (amount > 0) {
        user = await this.prisma.user.create({
          data: {
            id: userId,
            name: metadata?.name || metadata?.donorName || userId,
            platform: 'WHATSAPP',
            kakera: 0,
          },
        });
      } else {
        throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.', 404);
      }
    }

    if (amount < 0) {
      // Débito atômico garantindo que kakera >= -amount
      const result = await this.prisma.$transaction(async (tx) => {
        const updateResult = await tx.user.updateMany({
          where: {
            id: userId,
            kakera: { gte: -amount },
          },
          data: {
            kakera: { increment: amount },
          },
        });

        if (updateResult.count === 0) {
          throw new DomainError('INSUFFICIENT_KAKERA', 'Saldo de Kakera insuficiente para realizar o débito.');
        }

        await tx.kakeraTransaction.create({
          data: {
            userId,
            amount,
            reason,
            metadata,
          },
        });

        const updated = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, kakera: true },
        });

        return updated!;
      });

      return {
        userId: result.id,
        newBalance: result.kakera,
        amountModified: amount,
      };
    }

    // Crédito normal
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          kakera: { increment: amount },
        },
      });

      await tx.kakeraTransaction.create({
        data: {
          userId,
          amount,
          reason,
          metadata,
        },
      });

      return updated;
    });

    return {
      userId: result.id,
      newBalance: result.kakera,
      amountModified: amount,
    };
  }
}
