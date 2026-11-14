/**
 * Bootstrap do OpenTelemetry do waifuletes.
 *
 * Carregado ANTES do servidor:  node --import ./dist/instrumentation.js dist/server.js
 *
 * Fica totalmente desligado (nenhum pacote do SDK é carregado; @opentelemetry/api devolve tracer
 * no-op) a menos que OTEL_EXPORTER_OTLP_ENDPOINT (ou OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) esteja
 * definido e OTEL_SDK_DISABLED != "true". Qualquer falha aqui só gera um aviso: a API sobe
 * normalmente sem telemetria. Ver OBSERVABILITY.md na raiz do repo.
 */
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const disabled = String(process.env.OTEL_SDK_DISABLED || '').toLowerCase() === 'true';

if (endpoint && !disabled) {
  try {
    await start();
  } catch (err: any) {
    console.warn(`[otel] falha ao iniciar a telemetria; seguindo sem ela: ${err?.message}`);
  }
}

// --- Sanitização de URLs (defesa em profundidade; o collector também mascara) ---------------
const SENSITIVE_QUERY = /([?&][^=&#]*(?:key|token|auth|secret|password|passwd|signature|sig|session)[^=&#]*=)[^&#]*/gi;
const TELEGRAM_BOT_TOKEN = /\/bot\d+:[A-Za-z0-9_-]+/g;
const LONG_DIGITS = /\d{6,}/g;
const URL_ATTRS = ['url.full', 'url.path', 'url.query', 'http.url', 'http.target'];

function sanitizeUrl(value: string): string {
  return value
    .replace(TELEGRAM_BOT_TOKEN, '/bot{token}')
    .replace(SENSITIVE_QUERY, '$1REDACTED')
    .replace(LONG_DIGITS, '{n}');
}

/** Reescreve os atributos de URL já gravados no span (o SDK expõe `attributes` no span real). */
function sanitizeSpanUrls(span: any): void {
  const attrs = span?.attributes;
  if (!attrs) return;
  for (const key of URL_ATTRS) {
    const v = attrs[key];
    if (typeof v === 'string') {
      // url.path nunca deve carregar a query (o @fastify/otel grava request.url inteiro ali).
      const clean = sanitizeUrl(key === 'url.path' ? v.split('?')[0] : v);
      if (clean !== v) span.setAttribute(key, clean);
    }
  }
}

async function start(): Promise<void> {
  // Hook ESM: só o ioredis precisa (é importado direto de ESM; http/pino entram via require
  // do fastify e o undici via diagnostics_channel).
  const { register } = await import('node:module');
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url, { data: { include: ['ioredis'] } });

  const [
    { NodeSDK },
    { diag, DiagConsoleLogger, DiagLogLevel },
    { resourceFromAttributes },
    { OTLPTraceExporter },
    { OTLPMetricExporter },
    { PeriodicExportingMetricReader },
    { BatchSpanProcessor },
    { HttpInstrumentation },
    { UndiciInstrumentation },
    { IORedisInstrumentation },
    { PinoInstrumentation },
    { RuntimeNodeInstrumentation },
    fastifyOtel,
    fs,
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/api'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/exporter-trace-otlp-proto'),
    import('@opentelemetry/exporter-metrics-otlp-proto'),
    import('@opentelemetry/sdk-metrics'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/instrumentation-undici'),
    import('@opentelemetry/instrumentation-ioredis'),
    import('@opentelemetry/instrumentation-pino'),
    import('@opentelemetry/instrumentation-runtime-node'),
    import('@fastify/otel'),
    import('node:fs'),
  ]);
  const FastifyOtelInstrumentation = (fastifyOtel as any).FastifyOtelInstrumentation ?? (fastifyOtel as any).default?.FastifyOtelInstrumentation;

  // Erros de export (collector fora do ar) só aparecem no diag logger, nunca derrubam o processo.
  const level = (process.env.OTEL_LOG_LEVEL || 'error').toUpperCase() as keyof typeof DiagLogLevel;
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel[level] ?? DiagLogLevel.ERROR);

  let version = 'unknown';
  try {
    version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    /* sem versão */
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'waifuletes';
  const resource = resourceFromAttributes({
    'service.name': serviceName,
    'service.namespace': 'ravena',
    'service.version': version,
    'deployment.environment.name': process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || 'production',
  });

  // Ruído que não ajuda a achar gargalo: health checks, favicon e estáticos.
  const IGNORED_INCOMING = [/^\/health/, /^\/favicon/, /^\/media\//, /^\/css\//, /^\/js\//, /^\/vendor\//, /^\/assets\//, /^\/docs/, /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|woff2?)(?:\?|$)/i];
  const IGNORED_FASTIFY_ROUTES = /^\/(?:health|favicon|media|css|js|vendor|assets|docs)(?:\/|$|\.)/;
  const IGNORED_OUTGOING = [/\/v1\/(?:traces|metrics|logs)$/];

  const sdk = new NodeSDK({
    resource,
    // Fila limitada: se o collector cair, spans excedentes são descartados (nunca bloqueia).
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ timeoutMillis: 10000 }), {
        maxQueueSize: 4096,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 2000,
      }),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ timeoutMillis: 10000 }),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 30000),
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => IGNORED_INCOMING.some((re) => re.test(req.url || '')),
        ignoreOutgoingRequestHook: (opts) => IGNORED_OUTGOING.some((re) => re.test(opts.path || '')),
        requestHook: (span) => sanitizeSpanUrls(span),
        // Nenhum header vira atributo.
        headersToSpanAttributes: { client: { requestHeaders: [], responseHeaders: [] }, server: { requestHeaders: [], responseHeaders: [] } },
      }),
      new UndiciInstrumentation({
        ignoreRequestHook: (req) => IGNORED_OUTGOING.some((re) => re.test(req.path || '')),
        requestHook: (span) => sanitizeSpanUrls(span),
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        // Só o hook preHandler (auth/sessão) vira span; os demais hooks (cors, onRequest, onResponse)
        // custam ~0,1 ms e só poluíam o trace.
        instrumentHooks: ['preHandler'],
        ignorePaths: (route: { url?: string }) => IGNORED_FASTIFY_ROUTES.test(route?.url || ''),
        requestHook: (span: any) => sanitizeSpanUrls(span),
      }),
      new IORedisInstrumentation({
        requireParentSpan: true,
        // Só o nome do comando: chaves carregam token de sessão e userId.
        dbStatementSerializer: (cmdName: string) => cmdName,
      }),
      new PinoInstrumentation({ disableLogSending: true }),
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();
  (globalThis as any).__OTEL_ENABLED = true;

  // O server.ts já trata SIGINT/SIGTERM (server.close + process.exit). Aqui só expomos um flush
  // com teto de 3 s, chamado no onClose do Fastify, sem registrar handlers de sinal.
  (globalThis as any).__OTEL_SHUTDOWN = () =>
    Promise.race([sdk.shutdown().catch(() => {}), new Promise<void>((r) => setTimeout(r, 3000).unref())]);

  console.log(`[otel] telemetria ligada -> ${endpoint} (service.name=${serviceName})`);
}

export {};
