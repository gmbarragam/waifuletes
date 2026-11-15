import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';

import { config } from '../config.js';
import { isEnabled, withSpan, SpanKind } from '../telemetry.js';

/**
 * Spans manuais `prisma {Model}.{operation}` (só com a telemetria ligada).
 * @prisma/instrumentation 5.22 depende do sdk-trace-base 1.x e derruba o processo com o SDK 2.x
 * (TypeError em new Span no callback do engine), por isso não é usado. Nunca grava args/SQL.
 */
function withTracing(prisma: PrismaClient): PrismaClient {
  return prisma.$extends({
    name: 'otel-tracing',
    query: {
      $allOperations({ model, operation, args, query }) {
        const target = model ? `${model}.${operation}` : operation;
        return withSpan(
          `prisma ${target}`,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              'db.system.name': 'postgresql',
              'db.operation.name': operation,
              'db.collection.name': model,
            },
          },
          () => query(args)
        );
      },
    },
  }) as unknown as PrismaClient;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPlugin: FastifyPluginAsync = async (fastify) => {
  let dbUrl = config.DATABASE_URL;
  if (!dbUrl.includes('connection_limit=')) {
    const separator = dbUrl.includes('?') ? '&' : '?';
    dbUrl = `${dbUrl}${separator}connection_limit=10&pool_timeout=10`;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });

  await prisma.$connect();

  // O cliente estendido compartilha engine/conexões com o original; $disconnect continua valendo.
  fastify.decorate('prisma', isEnabled() ? withTracing(prisma) : prisma);

  fastify.addHook('onClose', async (server) => {
    await server.prisma.$disconnect();
  });
};

export default fp(prismaPlugin);
