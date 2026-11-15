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

/**
 * Primeira passada, no requestHook (antes de qualquer processor): tira token/segredo/dígitos longos.
 * A versão final (rota + allowlist de query / origem + caminho mascarado) é aplicada no onEnding.
 */
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

const FASTIFY_SCOPE = '@fastify/otel';
const STATUS_UNSET = 0;
const STATUS_ERROR = 2;
const SPAN_KIND_SERVER = 1;
const SPAN_KIND_CLIENT = 2;
const kClientError = Symbol('otel.clientError');

/** Erro "de negócio" (4xx): DomainError, erro de validação do Fastify ou qualquer statusCode < 500. */
function isClientError(err: any): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err.validation) return true;
  const sc = Number(err.statusCode ?? err.status);
  return Number.isFinite(sc) && sc >= 400 && sc < 500;
}

function errorTypeOf(err: any): string {
  const code = typeof err?.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(err.code) ? err.code : undefined;
  return code || (err?.validation ? 'VALIDATION_ERROR' : String(err?.name || 'Error').slice(0, 48));
}

/**
 * Normaliza spans antes do export (roda no onEnding, quando o span ainda aceita escrita):
 *  - spans do @fastify/otel que terminaram ERROR por um 4xx de negócio voltam a UNSET (semconv:
 *    4xx no servidor não é erro do serviço) e perdem a mensagem do status;
 *  - exceções 4xx gravadas nesses spans ficam só com o tipo/código (a mensagem traz input do usuário);
 *  - url.path de servidor = http.route; url.query por allowlist; url.full de cliente sem query e
 *    com segmentos de ID mascarados.
 */
function createNormalizingProcessor(urls: typeof import('./telemetryUrl.js')) {
  return {
    onStart(span: any) {
      if (span?.instrumentationScope?.name !== FASTIFY_SCOPE) return;
      const original = span.recordException.bind(span);
      span.recordException = (exception: any, time?: any) => {
        if (isClientError(exception)) {
          span[kClientError] = true;
          span.addEvent('exception', { 'exception.type': errorTypeOf(exception) }, time);
          return;
        }
        original(exception, time);
      };
    },
    onEnding(span: any) {
      const attrs = span?.attributes || {};
      if (span?.instrumentationScope?.name === FASTIFY_SCOPE && span.status?.code === STATUS_ERROR) {
        const sc = Number(attrs['http.response.status_code'] ?? attrs['http.status_code']);
        const is4xx = Number.isFinite(sc) ? sc < 500 : span[kClientError] === true;
        if (is4xx) span.status = { code: STATUS_UNSET };
      }
      // O span `request` do @fastify/otel é INTERNAL e repete o status HTTP do span SERVER pai. Na
      // leitura, o Jaeger deriva o status de spans sem status explícito a partir do código HTTP com
      // a regra de cliente (4xx -> ERROR): um 4xx de negócio aparecia como erro mesmo exportado
      // UNSET. Para 4xx o atributo sai do span interno (continua no span SERVER `POST /rota`).
      if (span?.instrumentationScope?.name === FASTIFY_SCOPE && span.status?.code !== STATUS_ERROR) {
        const sc = Number(attrs['http.response.status_code']);
        if (sc >= 400 && sc < 500) delete attrs['http.response.status_code'];
      }

      const isServer = span?.kind === SPAN_KIND_SERVER || span?.instrumentationScope?.name === FASTIFY_SCOPE;
      if (isServer) {
        if (typeof attrs['url.path'] === 'string' || typeof attrs['http.target'] === 'string') {
          const path = urls.serverPath(attrs['http.route'], attrs['url.path'] ?? attrs['http.target']);
          if (path !== undefined) {
            if (typeof attrs['url.path'] === 'string') span.setAttribute('url.path', path);
            if (typeof attrs['http.target'] === 'string') span.setAttribute('http.target', path);
          }
        }
        if (typeof attrs['url.query'] === 'string') span.setAttribute('url.query', urls.sanitizeQuery(attrs['url.query']));
      } else if (span?.kind === SPAN_KIND_CLIENT) {
        for (const key of ['url.full', 'http.url']) {
          if (typeof attrs[key] === 'string') span.setAttribute(key, urls.clientUrl(attrs[key]));
        }
        if (typeof attrs['url.path'] === 'string') span.setAttribute('url.path', urls.maskClientPath(attrs['url.path'].split('?')[0]));
        if (typeof attrs['http.target'] === 'string') span.setAttribute('http.target', urls.maskClientPath(attrs['http.target'].split('?')[0]));
        if (typeof attrs['url.query'] === 'string') span.setAttribute('url.query', 'REDACTED');
      }
    },
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * Diag logger enxuto: só a 1ª linha da mensagem (sem stack) e no máximo 1 vez por minuto por tipo
 * (ex.: ECONNREFUSED a cada export enquanto o collector está fora do ar).
 */
/** Resumo de um erro/objeto: `código: mensagem` (1ª linha), nunca a stack nem o JSON inteiro. */
function summarizeObject(o: any): string {
  const code = typeof o?.code === 'string' || typeof o?.code === 'number' ? String(o.code) : '';
  let msg = typeof o?.message === 'string' ? o.message.split('\n', 1)[0].trim() : '';
  // AggregateError (ECONNREFUSED em IPv4 + IPv6) vem com message vazia e os erros em `errors`.
  if (!msg && o?.errors !== undefined) {
    const first = Array.isArray(o.errors) ? o.errors[0] : String(o.errors).split(',', 1)[0];
    msg = first && typeof first === 'object' ? summarizeObject(first) : String(first ?? '').split('\n', 1)[0].trim();
  }
  // Sem message: só o cabeçalho da stack ("AggregateError [ECONNREFUSED]: "), nunca os frames.
  if (!msg && typeof o?.stack === 'string') msg = o.stack.split('\n', 1)[0].trim();
  if (code && msg.includes(code)) return msg;
  return code && msg ? `${code}: ${msg}` : code || msg || '[obj]';
}

/** 1ª linha de uma mensagem do diag; JSON embutido (o exporter serializa o erro) vira só message/code. */
export function diagFirstLine(v: unknown): string {
  if (v instanceof Error) {
    const s = summarizeObject(v);
    return s.startsWith(v.name) ? s : `${v.name}: ${s}`;
  }
  if (v && typeof v === 'object') return summarizeObject(v);
  const str = String(v);
  const at = str.indexOf('{');
  if (at >= 0) {
    const tail = str.slice(at);
    const end = tail.lastIndexOf('}');
    try {
      const o = JSON.parse(end >= 0 ? tail.slice(0, end + 1) : tail);
      if (o && typeof o === 'object') return `${str.slice(0, at)}${summarizeObject(o)}`.split('\n', 1)[0];
    } catch {
      /* não é JSON */
    }
  }
  return str.split('\n', 1)[0];
}

function createQuietDiagLogger() {
  const lastByKey = new Map<string, number>();
  const firstLine = diagFirstLine;
  const emit = (level: 'error' | 'warn' | 'info' | 'debug', message: string, args: unknown[]) => {
    const line = [firstLine(message), ...args.slice(0, 2).map(firstLine)].join(' ').slice(0, 300);
    const key = `${level}:${line.replace(/\d+/g, '#').slice(0, 120)}`;
    const now = Date.now();
    const last = lastByKey.get(key);
    if (last !== undefined && now - last < 60_000) return;
    if (lastByKey.size > 200) lastByKey.clear();
    lastByKey.set(key, now);
    console[level](`[otel] ${line}`);
  };
  return {
    error: (m: string, ...a: unknown[]) => emit('error', m, a),
    warn: (m: string, ...a: unknown[]) => emit('warn', m, a),
    info: (m: string, ...a: unknown[]) => emit('info', m, a),
    debug: (m: string, ...a: unknown[]) => emit('debug', m, a),
    verbose: (m: string, ...a: unknown[]) => emit('debug', m, a),
  };
}

async function start(): Promise<void> {
  // Hook ESM: só o ioredis precisa (é importado direto de ESM; http/pino entram via require
  // do fastify e o undici via diagnostics_channel).
  const { register } = await import('node:module');
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url, { data: { include: ['ioredis'] } });

  const [
    { NodeSDK },
    { diag, DiagLogLevel },
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
    telemetryUrl,
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
    import('./telemetryUrl.js'),
  ]);
  const FastifyOtelInstrumentation = (fastifyOtel as any).FastifyOtelInstrumentation ?? (fastifyOtel as any).default?.FastifyOtelInstrumentation;

  // Erros de export (collector fora do ar) só aparecem no diag logger, nunca derrubam o processo.
  const level = (process.env.OTEL_LOG_LEVEL || 'error').toUpperCase() as keyof typeof DiagLogLevel;
  diag.setLogger(createQuietDiagLogger(), DiagLogLevel[level] ?? DiagLogLevel.ERROR);

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
      // Antes do batch: normaliza status de 4xx e URLs enquanto o span ainda aceita escrita.
      createNormalizingProcessor(telemetryUrl) as any,
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
        requestHook: (span, req) => {
          sanitizeSpanUrls(span);
          // Guarda o span SERVER no IncomingMessage: o hook global do server.ts grava nele o ID
          // do usuário/grupo (telemetry.ts → setRequestAttrs).
          if ((span as any).kind === SPAN_KIND_SERVER) (req as any)[Symbol.for('ravena.otel.server_span')] = span;
        },
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
        // Os handlers são `handler: async (...) => {}` e o span saía `handler - handler`: usa a rota
        // (template, cardinalidade limitada), ex.: `handler - /roll`.
        lifecycleHook: (span: any, info: { hookName?: string; request?: any; handler?: string }) => {
          const route = info?.request?.routeOptions?.url;
          if (info?.hookName === 'handler' && typeof route === 'string' && route) span.updateName(`handler - ${route}`);
        },
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

  // O construtor do NodeSDK troca o logger de diagnóstico quando OTEL_LOG_LEVEL está definido;
  // reaplica o logger compacto (sem stack, com limite de frequência).
  diag.setLogger(createQuietDiagLogger(), DiagLogLevel[level] ?? DiagLogLevel.ERROR);
  sdk.start();
  (globalThis as any).__OTEL_ENABLED = true;

  // O server.ts já trata SIGINT/SIGTERM (server.close + process.exit). Aqui só expomos um flush
  // com teto de 3 s, chamado no onClose do Fastify, sem registrar handlers de sinal.
  (globalThis as any).__OTEL_SHUTDOWN = () =>
    Promise.race([sdk.shutdown().catch(() => {}), new Promise<void>((r) => setTimeout(r, 3000).unref())]);

  console.log(`[otel] telemetria ligada -> ${endpoint} (service.name=${serviceName})`);
}

export {};
