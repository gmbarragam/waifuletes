/**
 * Helpers de tracing de negócio do waifuletes (mesma API de ravena-ai/src/telemetry/index.js).
 *
 * Só depende de @opentelemetry/api: com a telemetria desligada, tudo aqui é no-op barato
 * (tracer no-op; hashId devolve undefined sem calcular HMAC).
 *
 * Privacidade (ver OBSERVABILITY.md): NUNCA passar para atributos/eventos ID cru de usuário/grupo,
 * nomes, textos, chaves de Redis, segredos. IDs de pessoa só via hashUserId(); grupos via hashId().
 */
import crypto from 'node:crypto';
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  ROOT_CONTEXT,
  type Attributes,
  type AttributeValue,
  type Context,
  type Link,
  type Span,
} from '@opentelemetry/api';

export { SpanKind, SpanStatusCode, trace, context, ROOT_CONTEXT };
export type { Span };

export const tracer = trace.getTracer('waifuletes');

const ID_SALT = process.env.OTEL_ID_SALT || crypto.randomBytes(32).toString('hex');

export function isEnabled(): boolean {
  return (globalThis as any).__OTEL_ENABLED === true;
}

/** Pseudônimo estável (HMAC-SHA256 truncado em 16 hex) para IDs de usuário/grupo. undefined se desligado. */
export function hashId(id: unknown): string | undefined {
  if (!isEnabled() || id === undefined || id === null || id === '') return undefined;
  return crypto.createHmac('sha256', ID_SALT).update(String(id)).digest('hex').slice(0, 16);
}

/**
 * Forma canônica do ID de pessoa para o HMAC, IGUAL à da ravena-ai (src/telemetry/index.js →
 * hashUserId): tira o sufixo `@c.us`/`@lid`/`@s.whatsapp.net` e o `:device`. Idempotente.
 * Assim `5511…@c.us`, `5511…` e `5511…:3@s.whatsapp.net` geram o mesmo hash nos 3 serviços e
 * um operador com o OTEL_ID_SALT consegue recomputar o hash localmente.
 */
export function normalizeUserId(id: unknown): string | undefined {
  if (id === undefined || id === null || id === '') return undefined;
  const raw = String(id);
  return raw.split('@')[0].split(':')[0] || raw;
}

/** hashId da forma canônica do usuário (ver normalizeUserId). Grupos/chats usam hashId cru. */
export function hashUserId(id: unknown): string | undefined {
  return hashId(normalizeUserId(id));
}

type AttrInput = Record<string, unknown> | undefined;

const kServerSpan = Symbol.for('ravena.otel.server_span');

/** Guarda o span SERVER do instrumentation-http no IncomingMessage (chamado pelo requestHook). */
export function stashServerSpan(span: unknown, req: unknown): void {
  if (span && req && typeof req === 'object' && (span as any).kind === SpanKind.SERVER) (req as any)[kServerSpan] = span;
}

/**
 * Grava atributos nos spans da requisição HTTP de entrada: o SERVER (`POST /roll`) e o `request`
 * do @fastify/otel. Usado para o hash do usuário/grupo em rotas sem span de negócio.
 */
export function setRequestAttrs(request: any, attrs: AttrInput): void {
  if (!isEnabled() || !request) return;
  const clean = cleanAttrs(attrs);
  if (!clean || Object.keys(clean).length === 0) return;
  const spans = new Set<Span>();
  const server = request.raw?.[kServerSpan];
  if (server) spans.add(server);
  try {
    const reqSpan = typeof request.opentelemetry === 'function' ? request.opentelemetry().span : undefined;
    if (reqSpan) spans.add(reqSpan);
  } catch {
    /* sem @fastify/otel */
  }
  for (const s of spans) if (s.isRecording()) s.setAttributes(clean);
}

function pickId(...sources: any[]): unknown {
  for (const src of sources) {
    if (src && typeof src === 'object') {
      for (const key of ['userId', 'user_id']) {
        const v = src[key];
        if (typeof v === 'string' || typeof v === 'number') return v;
      }
    }
  }
  return undefined;
}

function pickGroup(...sources: any[]): unknown {
  for (const src of sources) {
    const v = src && typeof src === 'object' ? src.groupId : undefined;
    if (typeof v === 'string' || typeof v === 'number') return v;
  }
  return undefined;
}

/**
 * Hook global (preValidation, depois do parse do corpo): `userId`/`groupId` de params, corpo ou
 * query viram `waifu.user.id_hash`/`waifu.group.id_hash` nos spans da requisição.
 */
export function tagRequestIds(request: any): void {
  if (!isEnabled() || !request) return;
  const user = pickId(request.params, request.body, request.query);
  const group = pickGroup(request.params, request.body, request.query);
  if (user === undefined && group === undefined) return;
  setRequestAttrs(request, { 'waifu.user.id_hash': hashUserId(user), 'waifu.group.id_hash': hashId(group) });
}

function cleanAttrs(attrs: AttrInput): Attributes | undefined {
  if (!attrs) return undefined;
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = (typeof v === 'object' && !Array.isArray(v) ? String(v) : v) as AttributeValue;
  }
  return out;
}

/** Marca o span como erro (exceção + error.type) sem vazar dados além da mensagem. */
export function recordError(span: Span | undefined, err: unknown, errorType?: string): void {
  if (!span || !span.isRecording()) return;
  const e = err instanceof Error ? err : new Error(String(err));
  span.recordException(e);
  span.setAttribute('error.type', errorType || (e as any).code || e.name || 'Error');
  span.setAttribute('app.outcome', 'error');
  span.setStatus({ code: SpanStatusCode.ERROR, message: e.name });
}

export interface SpanOpts {
  attributes?: AttrInput;
  kind?: SpanKind;
  /** Começa um trace novo (ignora o contexto ativo). */
  root?: boolean;
  links?: Link[];
}

/**
 * Executa fn dentro de um span ativo. Exceções marcam o span como erro e são relançadas.
 */
export function withSpan<T>(name: string, opts: SpanOpts, fn: (span: Span) => T): T {
  const spanOpts = { kind: opts.kind ?? SpanKind.INTERNAL, attributes: cleanAttrs(opts.attributes), links: opts.links };
  const parentCtx = opts.root ? ROOT_CONTEXT : context.active();
  return tracer.startActiveSpan(name, spanOpts, parentCtx, (span) => {
    let result: T;
    try {
      result = fn(span);
    } catch (err) {
      recordError(span, err);
      span.end();
      throw err;
    }
    if (result && typeof (result as any).then === 'function') {
      return (result as any).then(
        (v: unknown) => {
          span.end();
          return v;
        },
        (err: unknown) => {
          recordError(span, err);
          span.end();
          throw err;
        }
      ) as T;
    }
    span.end();
    return result;
  });
}

/** Inicia um span manual (o chamador encerra). */
export function startSpan(name: string, opts: SpanOpts = {}, parentCtx?: Context): Span {
  return tracer.startSpan(
    name,
    { kind: opts.kind ?? SpanKind.INTERNAL, attributes: cleanAttrs(opts.attributes), links: opts.links },
    parentCtx || (opts.root ? ROOT_CONTEXT : context.active())
  );
}

export function activeSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/** Define atributos no span (padrão: o ativo), ignorando undefined. */
export function setAttrs(attrs: AttrInput, span?: Span): void {
  const s = span || trace.getActiveSpan();
  if (s && s.isRecording()) s.setAttributes(cleanAttrs(attrs) || {});
}

/** Span event (marco pontual) no span (padrão: o ativo). */
export function addEvent(name: string, attrs?: AttrInput, span?: Span): void {
  const s = span || trace.getActiveSpan();
  if (s && s.isRecording()) s.addEvent(name, cleanAttrs(attrs));
}

/** Resultado de negócio padronizado entre os 3 serviços (app.outcome / app.reject.reason). */
export function setOutcome(outcome: 'ok' | 'rejected' | 'error', reason?: string, span?: Span): void {
  setAttrs({ 'app.outcome': outcome, 'app.reject.reason': outcome === 'rejected' ? reason : undefined }, span);
}

/**
 * Converte códigos de erro de domínio (ex.: COOLDOWN_ACTIVE) num enum curto e estável para
 * app.reject.reason. Só aceita [A-Z0-9_], até 48 chars; outra coisa vira 'other'.
 */
export function reasonFromCode(code: unknown): string {
  if (typeof code !== 'string') return 'other';
  return /^[A-Z0-9_]{1,48}$/.test(code) ? code.toLowerCase() : 'other';
}

/** Erro de negócio esperado (DomainError com status < 500): vira rejected, não ERROR. */
function isExpectedRejection(err: any): boolean {
  return Boolean(err && typeof err.code === 'string' && typeof err.statusCode === 'number' && err.statusCode < 500);
}

/**
 * Span de negócio: além do withSpan, classifica o resultado em app.outcome:
 * - retorno `{ success: false, error: { code } }` ou DomainError (< 500) → rejected + app.reject.reason;
 * - outra exceção → error (status ERROR, error.type, exceção registrada);
 * - senão → ok (a menos que o próprio fn já tenha definido app.outcome).
 */
export function withBusinessSpan<T>(name: string, attributes: AttrInput, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL, attributes: cleanAttrs(attributes) }, async (span) => {
    try {
      const result: any = await fn(span);
      if (span.isRecording() && !(span as any).attributes?.['app.outcome']) {
        if (result && result.success === false) setOutcome('rejected', reasonFromCode(result.error?.code), span);
        else setOutcome('ok', undefined, span);
      }
      return result as T;
    } catch (err: any) {
      if (isExpectedRejection(err)) {
        setOutcome('rejected', reasonFromCode(err.code), span);
      } else {
        recordError(span, err);
      }
      throw err;
    } finally {
      span.end();
    }
  });
}
