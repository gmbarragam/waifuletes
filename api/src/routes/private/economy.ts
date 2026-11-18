import { FastifyPluginAsync } from 'fastify';
import { verifyApiKey } from '../../plugins/auth.js';
import { EconomySummaryService } from '../../services/EconomySummaryService.js';
import { withBusinessSpan, setAttrs } from '../../telemetry.js';

/** Tolerância de relógio para `to` no futuro. */
const FUTURE_TOLERANCE_MS = 60_000;
/** Maior epoch em ms representável por Date. */
const MAX_EPOCH_MS = 8_640_000_000_000_000;

export const privateEconomyRoutes: FastifyPluginAsync = async (fastify) => {
  const economyService = new EconomySummaryService(fastify.prisma);

  // onRequest (antes da validação da querystring): sem a chave, a resposta é sempre 401, nunca 400.
  fastify.addHook('onRequest', verifyApiKey);

  fastify.get('/internal/economy/summary', {
    schema: {
      description:
        'Resumo agregado da economia de Zinthos para o painel da Ravena (fluxos por hora e motivo, retrato dos saldos e quintos). Sem dados por jogador.',
      tags: ['Kakera & Economia (Privado)'],
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'integer', minimum: 0, maximum: MAX_EPOCH_MS },
          to: { type: 'integer', minimum: 1, maximum: MAX_EPOCH_MS },
          // 1 pede receivedByQuintile (só para janelas de até 8 dias); a carga da Ravena pede uma vez por dia.
          received: { type: 'integer', enum: [0, 1], default: 0 },
          // 0 pula o retrato dos saldos (balances: null) — usado nos pedaços históricos da carga inicial.
          balances: { type: 'integer', enum: [0, 1], default: 1 },
        },
      },
    },
    handler: async (request, reply) => {
      const { from, to, received, balances } = request.query as {
        from: number;
        to: number;
        received?: number;
        balances?: number;
      };
      const now = Date.now();

      const result = await withBusinessSpan(
        'economy summary',
        {
          'waifu.economy.window_ms': to - from,
          'waifu.economy.full_history': from === 0,
          'waifu.economy.received': received === 1,
          'waifu.economy.balances': balances !== 0,
        },
        async () => {
          if (!(to > from)) {
            return { success: false as const, error: { code: 'INVALID_WINDOW', message: '`to` deve ser maior que `from`.' } };
          }
          if (to > now + FUTURE_TOLERANCE_MS) {
            return { success: false as const, error: { code: 'INVALID_WINDOW', message: '`to` não pode estar no futuro.' } };
          }
          const summary = await economyService.getSummary(from, to, now, { received: received === 1, balances: balances !== 0 });
          setAttrs({
            'waifu.economy.flow_rows': summary.ledger.flows.length,
            'waifu.economy.holders': summary.balances?.holders,
          });
          return summary;
        }
      );

      if ('success' in result && result.success === false) {
        return reply.status(400).send(result);
      }
      return reply.send(result);
    },
  });
};
