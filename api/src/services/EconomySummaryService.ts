import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Resumo agregado da economia de Zinthos (tabela `users.kakera` + extrato `kakera_transactions`)
 * para o painel da economia da Ravena. Nenhum dado por jogador sai daqui: só totais, contagens e
 * faixas (quintos). Toda a agregação é feita no Postgres.
 */

export const ECONOMY_SCHEMA_VERSION = 1;

/** Grupos com menos membros que isto têm os valores anulados (evita identificar alguém). */
export const MIN_GROUP_SIZE = 10;

/** `receivedByQuintile` só é calculado quando pedido (`received=1`) e para janelas de até 8 dias. */
export const RECEIVED_MAX_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * O ADMIN_GRANT junta coisas diferentes (câmbio do banco da Ravena, bônus de doador, prêmio do caça-níquel,
 * edição no painel, concessão manual). Quem chama distingue pelo metadata: `metadata.reason` (banco da
 * Ravena: bank_withdraw_zinthos, bank_deposit_runas, ...) ou, na falta dele, `metadata.source`
 * (grantZinthos da Ravena: DONOR_BONUS, SLOTS_PRIZE; painel: admin_panel_edit). Nos fluxos o motivo vira
 * `ADMIN_GRANT:<valor em minúsculas>`; valor fora de [a-z0-9_]{1,64} vira `ADMIN_GRANT:other`, para que texto
 * livre do chamador não exploda a cardinalidade. Sem reason/source em texto, fica `ADMIN_GRANT`.
 */
export const ADMIN_GRANT_SUFFIX_MAX = 64;
const reasonKeySql = Prisma.sql`(
  CASE
    WHEN reason = 'ADMIN_GRANT' AND (
      (jsonb_typeof(metadata->'reason') = 'string' AND metadata->>'reason' <> '')
      OR (jsonb_typeof(metadata->'source') = 'string' AND metadata->>'source' <> '')
    ) THEN
      CASE
        WHEN lower(COALESCE(NULLIF(
               CASE WHEN jsonb_typeof(metadata->'reason') = 'string' THEN metadata->>'reason' END, ''),
               metadata->>'source')) ~ ${`^[a-z0-9_]{1,${ADMIN_GRANT_SUFFIX_MAX}}$`}
        THEN 'ADMIN_GRANT:' || lower(COALESCE(NULLIF(
               CASE WHEN jsonb_typeof(metadata->'reason') = 'string' THEN metadata->>'reason' END, ''),
               metadata->>'source'))
        ELSE 'ADMIN_GRANT:other'
      END
    ELSE reason::text
  END
)`;

/**
 * Motivos (já com o sufixo do ADMIN_GRANT) que criam moeda nova e entram em `receivedByQuintile`.
 * Ficam de fora:
 * - ADMIN_GRANT e os demais ADMIN_GRANT:*: câmbio do banco (bank_*), edição do painel, concessões manuais e
 *   valores desconhecidos não são criação clara;
 * - MARKET_TRADE: transferência entre jogadores;
 * - MARKET_BUY e HOSTING_FEE: saídas;
 * - HOSTING_FEE_WAIFU: registra o valor de waifus confiscadas abatido da dívida, não é crédito no saldo.
 */
export const CREATION_REASONS = [
  'DAILY_REWARD',
  'ROLL_CRYSTAL',
  'DIVORCE',
  'EVENT_REWARD',
  'WISHLIST_BONUS',
  'SOULMATE_BONUS',
  'MARKET_REFUND',
  'ADMIN_GRANT:donor_bonus',
  'ADMIN_GRANT:slots_prize',
] as const;

export interface EconomyFlow {
  hour: number;
  reason: string;
  amountIn: number;
  amountOut: number;
  count: number;
  users: number;
}

export interface EconomyQuintile {
  q: number;
  n: number;
  min: number | null;
  max: number | null;
  sum: number | null;
}

export interface EconomyReceivedQuintile {
  q: number;
  n: number;
  receivedSum: number | null;
  receivedMedian: number | null;
}

export interface EconomySummary {
  currency: 'zinthos';
  schemaVersion: number;
  generatedAt: number;
  window: { from: number; to: number };
  ledger: { available: boolean; flows: EconomyFlow[] };
  balances: {
    total: number;
    holders: number;
    accounts: number;
    p50: number | null;
    p90: number | null;
    top10Share: number | null;
    quintiles: EconomyQuintile[];
  };
  receivedByQuintile: EconomyReceivedQuintile[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Converte epoch em ms para `timestamp` (sem fuso, em UTC) com aritmética inteira, sem depender do fuso da sessão. */
const tsFromMs = (ms: number) => Prisma.sql`(TIMESTAMP '1970-01-01 00:00:00' + (${BigInt(ms)}::bigint * INTERVAL '1 millisecond'))`;

export class EconomySummaryService {
  constructor(private prisma: PrismaClient) {}

  async getSummary(
    from: number,
    to: number,
    now: number = Date.now(),
    opts: { received?: boolean } = {}
  ): Promise<EconomySummary> {
    const fromTs = tsFromMs(from);
    const toTs = tsFromMs(to);
    const includeReceived = Boolean(opts.received) && to - from <= RECEIVED_MAX_WINDOW_MS;

    // Fluxos do extrato por hora (UTC) e motivo.
    const flowsQuery = this.prisma.$queryRaw<
      Array<{ hour: bigint; reason: string; amount_in: bigint; amount_out: bigint; tx_count: bigint; users: bigint }>
    >`
      SELECT
        (EXTRACT(EPOCH FROM date_trunc('hour', "createdAt"))::bigint * 1000) AS hour,
        ${reasonKeySql} AS reason,
        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::bigint AS amount_in,
        COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::bigint AS amount_out,
        COUNT(*)::bigint AS tx_count,
        COUNT(DISTINCT "userId")::bigint AS users
      FROM kakera_transactions
      WHERE "createdAt" >= ${fromTs} AND "createdAt" < ${toTs}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    // Retrato dos saldos: total e contas (todas), estatísticas entre quem tem saldo > 0.
    const totalsQuery = this.prisma.$queryRaw<Array<{ total: bigint; accounts: bigint }>>`
      SELECT COALESCE(SUM(kakera), 0)::bigint AS total, COUNT(*)::bigint AS accounts FROM users
    `;
    const holdersQuery = this.prisma.$queryRaw<
      Array<{ holders: bigint; mass: bigint; top_mass: bigint; p50: number | null; p90: number | null }>
    >`
      WITH h AS (
        SELECT kakera,
               row_number() OVER (ORDER BY kakera DESC, id) AS rn,
               COUNT(*) OVER () AS cnt
        FROM users WHERE kakera > 0
      )
      SELECT
        COUNT(*)::bigint AS holders,
        COALESCE(SUM(kakera), 0)::bigint AS mass,
        COALESCE(SUM(kakera) FILTER (WHERE rn <= CEIL(cnt * 0.1)), 0)::bigint AS top_mass,
        percentile_disc(0.5) WITHIN GROUP (ORDER BY kakera) AS p50,
        percentile_disc(0.9) WITHIN GROUP (ORDER BY kakera) AS p90
      FROM h
    `;
    // Quintos por saldo, da menor para a maior faixa. O desempate por id deixa as faixas determinísticas
    // e iguais às usadas em receivedByQuintile.
    const quintilesQuery = this.prisma.$queryRaw<
      Array<{ q: number; n: bigint; min: number; max: number; sum: bigint }>
    >`
      WITH h AS (
        SELECT kakera, ntile(5) OVER (ORDER BY kakera, id) AS q FROM users WHERE kakera > 0
      )
      SELECT q::int AS q, COUNT(*)::bigint AS n, MIN(kakera) AS min, MAX(kakera) AS max, SUM(kakera)::bigint AS sum
      FROM h GROUP BY q ORDER BY q
    `;
    // Entradas de motivos de criação na janela, por faixa de saldo atual. A mediana considera todos os
    // membros da faixa (quem não recebeu nada conta como 0).
    const receivedQuery = this.prisma.$queryRaw<
      Array<{ q: number; n: bigint; received_sum: bigint; received_median: bigint | null }>
    >`
      WITH h AS (
        SELECT id, ntile(5) OVER (ORDER BY kakera, id) AS q FROM users WHERE kakera > 0
      ),
      r AS (
        SELECT "userId", SUM(amount)::bigint AS received
        FROM kakera_transactions
        WHERE "createdAt" >= ${fromTs} AND "createdAt" < ${toTs}
          AND amount > 0
          AND ${reasonKeySql} IN (${Prisma.join([...CREATION_REASONS])})
        GROUP BY "userId"
      ),
      m AS (
        SELECT h.q, COALESCE(r.received, 0)::bigint AS received FROM h LEFT JOIN r ON r."userId" = h.id
      )
      SELECT q::int AS q, COUNT(*)::bigint AS n, SUM(received)::bigint AS received_sum,
             percentile_disc(0.5) WITHIN GROUP (ORDER BY received) AS received_median
      FROM m GROUP BY q ORDER BY q
    `;

    // Um único retrato (REPEATABLE READ): as faixas de balances e de receivedByQuintile batem entre si.
    const [flowRows, totalsRows, holdersRows, quintileRows, receivedRows] = await this.prisma.$transaction(
      [flowsQuery, totalsQuery, holdersQuery, quintilesQuery, includeReceived ? receivedQuery : this.prisma.$queryRaw`SELECT 1`] as any,
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    ) as [any[], any[], any[], any[], any[]];

    const flows: EconomyFlow[] = flowRows.map((r) => ({
      hour: num(r.hour),
      reason: r.reason,
      amountIn: num(r.amount_in),
      amountOut: num(r.amount_out),
      count: num(r.tx_count),
      users: num(r.users),
    }));

    const totals = totalsRows[0] || {};
    const hs = holdersRows[0] || {};
    const holders = num(hs.holders);
    const mass = num(hs.mass);

    const quintiles: EconomyQuintile[] = [1, 2, 3, 4, 5].map((q) => {
      const row = quintileRows.find((r) => Number(r.q) === q);
      const n = row ? num(row.n) : 0;
      const visible = n >= MIN_GROUP_SIZE;
      return {
        q,
        n,
        min: visible ? numOrNull(row.min) : null,
        max: visible ? numOrNull(row.max) : null,
        sum: visible ? numOrNull(row.sum) : null,
      };
    });

    const receivedByQuintile: EconomyReceivedQuintile[] = includeReceived
      ? [1, 2, 3, 4, 5].map((q) => {
          const row = receivedRows.find((r) => Number(r.q) === q);
          const n = row ? num(row.n) : 0;
          const visible = n >= MIN_GROUP_SIZE;
          return {
            q,
            n,
            receivedSum: visible ? numOrNull(row.received_sum) : null,
            receivedMedian: visible ? numOrNull(row.received_median) : null,
          };
        })
      : [];

    return {
      currency: 'zinthos',
      schemaVersion: ECONOMY_SCHEMA_VERSION,
      generatedAt: now,
      window: { from, to },
      ledger: { available: true, flows },
      balances: {
        total: num(totals.total),
        holders,
        accounts: num(totals.accounts),
        p50: holders > 0 ? numOrNull(hs.p50) : null,
        p90: holders > 0 ? numOrNull(hs.p90) : null,
        top10Share: mass > 0 ? num(hs.top_mass) / mass : null,
        quintiles,
      },
      receivedByQuintile,
    };
  }
}
