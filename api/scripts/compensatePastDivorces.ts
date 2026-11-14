/**
 * Script de compensação retroativa para usuários que se divorciaram antes da implementação
 * dos bônus multiplicadores de rank por categoria (1x a 7x).
 *
 * Modo de uso:
 *   npx tsx scripts/compensatePastDivorces.ts           # Modo Simulação (Dry-Run)
 *   npx tsx scripts/compensatePastDivorces.ts --apply   # Aplica os créditos no banco
 */

import { PrismaClient, Rarity } from '@prisma/client';

// Suporta execução tanto no host (src/) quanto dentro do container Docker (dist/)
let calculateRankMultiplier: (position: number, totalInRarity: number) => number;
try {
  const mod = await import('../src/utils/rarityCalculator.js');
  calculateRankMultiplier = mod.calculateRankMultiplier;
} catch {
  const mod = await import('../dist/utils/rarityCalculator.js');
  calculateRankMultiplier = mod.calculateRankMultiplier;
}

const prisma = new PrismaClient();

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n=============================================================`);
  console.log(`🔍 Compensação Retroativa de Divórcios com Bônus de Rank`);
  console.log(`   Modo: ${isApply ? '🚀 APLICAÇÃO REAL (--apply)' : '🧪 SIMULAÇÃO (Dry-Run)'}`);
  console.log(`=============================================================\n`);

  // 1. Contagem total por raridade para base de cálculo
  const rarityCounts = new Map<Rarity, number>();
  const rarities = [Rarity.COMMON, Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY];
  for (const r of rarities) {
    const cnt = await prisma.character.count({ where: { baseRarity: r, isActive: true } });
    rarityCounts.set(r, Math.max(1, cnt));
  }

  // 2. Busca todas as transações de DIVORCE que ainda não receberam o bônus de rank
  const transactions = await prisma.kakeraTransaction.findMany({
    where: {
      reason: 'DIVORCE',
      amount: { gt: 0 },
    },
    include: {
      user: {
        select: { id: true, name: true, publicId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Encontradas ${transactions.length} transações de divórcio no banco de dados.\n`);

  const userCompensations = new Map<string, {
    userName: string;
    totalCompensation: number;
    details: Array<{
      txId: string;
      characterName: string;
      rarity: string;
      paidAmount: number;
      rankMultiplier: number;
      bonusDiff: number;
    }>;
  }>();

  let totalDiffAllUsers = 0;
  let totalEligibleTransactions = 0;

  for (const tx of transactions) {
    const meta = (tx.metadata as any) || {};

    // Se já foi processada ou já possuía o multiplicador, pula
    if (meta.rankMultiplier || meta.compensated) {
      continue;
    }

    const charId = meta.characterId;
    if (!charId) continue;

    const character = await prisma.character.findUnique({
      where: { id: charId },
      select: { id: true, name: true, baseRarity: true, rarityRank: true, rank: true, popularityScore: true, claimCount: true },
    });

    if (!character) continue;

    const rarity = character.baseRarity;
    const totalInRarity = rarityCounts.get(rarity) || 1;

    let position = character.rarityRank ?? null;
    if (!position) {
      const countResult = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count
        FROM characters
        WHERE "baseRarity" = ${rarity}::"Rarity"
          AND "isActive" = true
          AND (
            (rank IS NOT NULL AND ${character.rank ?? null} IS NOT NULL AND rank < ${character.rank})
            OR (${character.rank ?? null} IS NULL AND rank IS NOT NULL)
            OR (
              (rank = ${character.rank ?? null} OR (rank IS NULL AND ${character.rank ?? null} IS NULL))
              AND "popularityScore" > ${character.popularityScore ?? 0}
            )
            OR (
              (rank = ${character.rank ?? null} OR (rank IS NULL AND ${character.rank ?? null} IS NULL))
              AND "popularityScore" = ${character.popularityScore ?? 0}
              AND "claimCount" > ${character.claimCount ?? 0}
            )
            OR (
              (rank = ${character.rank ?? null} OR (rank IS NULL AND ${character.rank ?? null} IS NULL))
              AND "popularityScore" = ${character.popularityScore ?? 0}
              AND "claimCount" = ${character.claimCount ?? 0}
              AND id < ${character.id}
            )
          )
      `;
      position = Number(countResult[0]?.count || 0) + 1;
    }

    const rankMultiplier = calculateRankMultiplier(position, totalInRarity);
    if (rankMultiplier <= 1.0) continue; // Posição básica sem bônus adicional

    const paid = tx.amount;
    const recalculated = Math.ceil(paid * rankMultiplier);
    const diff = recalculated - paid;

    if (diff <= 0) continue;

    totalEligibleTransactions++;
    totalDiffAllUsers += diff;

    const cur = userCompensations.get(tx.userId) || {
      userName: tx.user?.name || tx.userId,
      totalCompensation: 0,
      details: [],
    };

    cur.totalCompensation += diff;
    cur.details.push({
      txId: tx.id,
      characterName: character.name,
      rarity: character.baseRarity,
      paidAmount: paid,
      rankMultiplier,
      bonusDiff: diff,
    });
    userCompensations.set(tx.userId, cur);
  }

  console.log(`📊 Resumo da Análise:`);
  console.log(`   - Usuários elegíveis a bônus: ${userCompensations.size}`);
  console.log(`   - Divórcios recalculados: ${totalEligibleTransactions}`);
  console.log(`   - Total de Zinthos a compensar: ${totalDiffAllUsers.toLocaleString('pt-BR')}\n`);

  if (userCompensations.size === 0) {
    console.log(`✅ Nenhuma compensação pendente necessária.`);
    process.exit(0);
  }

  // Lista os 10 maiores beneficiados no log
  const sortedUsers = [...userCompensations.entries()].sort((a, b) => b[1].totalCompensation - a[1].totalCompensation);
  console.log(`Top 10 Usuários a serem compensados:`);
  sortedUsers.slice(0, 10).forEach(([uid, data], i) => {
    console.log(`  ${i + 1}. ${data.userName} (${uid}): +${data.totalCompensation.toLocaleString('pt-BR')} Zinthos (${data.details.length} divórcios)`);
  });

  if (!isApply) {
    console.log(`\nℹ️ Para efetivar o crédito nos saldos, execute novamente com a flag --apply:`);
    console.log(`   npx tsx scripts/compensatePastDivorces.ts --apply\n`);
    process.exit(0);
  }

  console.log(`\n🚀 Aplicando créditos atômicos no banco de dados...`);
  let appliedCount = 0;

  for (const [userId, data] of userCompensations.entries()) {
    await prisma.$transaction(async (tx) => {
      // 1. Incrementa saldo do usuário
      await tx.user.update({
        where: { id: userId },
        data: { kakera: { increment: data.totalCompensation } },
      });

      // 2. Cria transação de extrato de compensação
      await tx.kakeraTransaction.create({
        data: {
          userId,
          amount: data.totalCompensation,
          reason: 'ADMIN_GRANT',
          metadata: {
            type: 'rank_divorce_compensation',
            description: 'Compensação retroativa de bônus por rank de categoria em divórcios anteriores',
            recalculatedDivorces: data.details.length,
            details: data.details,
          },
        },
      });

      // 3. Marca as transações originais como compensadas
      for (const item of data.details) {
        const origTx = transactions.find((t) => t.id === item.txId);
        const origMeta = (origTx?.metadata as any) || {};
        await tx.kakeraTransaction.update({
          where: { id: item.txId },
          data: {
            metadata: {
              ...origMeta,
              compensated: true,
              rankMultiplier: item.rankMultiplier,
              compensationDiff: item.bonusDiff,
            },
          },
        });
      }
    });

    appliedCount++;
    if (appliedCount % 50 === 0 || appliedCount === userCompensations.size) {
      console.log(`   Progresso: ${appliedCount}/${userCompensations.size} usuários creditados...`);
    }
  }

  console.log(`\n🎉 Sucesso! Todos os ${userCompensations.size} usuários foram compensados com +${totalDiffAllUsers.toLocaleString('pt-BR')} Zinthos.`);
  process.exit(0);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro na execução da compensação:', err);
    process.exit(1);
  });
