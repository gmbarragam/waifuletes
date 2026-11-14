# Observabilidade (OpenTelemetry)

O waifuletes exporta **traces** e **métricas** via OTLP/HTTP para o stack de observabilidade do
ecossistema Ravena. A telemetria é **opcional** e fica **desligada por padrão**.

## Como ligar

1. Suba o backend (uma vez, no host), que fica no repositório da ravena:
   ```bash
   cd ravena-ai/observability && docker compose up -d
   ```
   Collector OTLP em `:4317/:4318`, Jaeger em http://localhost:16686, Grafana em http://localhost:3001.
2. No `.env` deste repo (o `docker-compose.yml` já usa `env_file: .env`, nada a mudar no compose):
   ```env
   OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
   OTEL_SERVICE_NAME=waifuletes
   OTEL_ID_SALT=<o mesmo valor usado na ravena-ai e no jardim-das-sombras>
   ```
3. `docker compose up -d api` (recria só o container da API). No log aparece
   `[otel] telemetria ligada -> http://host.docker.internal:4318`.

Para desligar: remova `OTEL_EXPORTER_OTLP_ENDPOINT` ou defina `OTEL_SDK_DISABLED=true`.

## Variáveis

| Variável | Padrão | Efeito |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vazio | Liga a telemetria. Sem ela (ou sem `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) nada do SDK é carregado. |
| `OTEL_SDK_DISABLED` | vazio | `true` desliga mesmo com endpoint. |
| `OTEL_SERVICE_NAME` | `waifuletes` | `service.name` dos spans. |
| `OTEL_ID_SALT` | aleatório por processo | Segredo do HMAC dos IDs de usuário/grupo. Igual nos 3 serviços para correlacionar. |
| `OTEL_LOG_LEVEL` | `error` | Log interno do SDK (erros de export aparecem aqui). |
| `OTEL_METRIC_EXPORT_INTERVAL` | `30000` | Intervalo de export de métricas (ms). |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `NODE_ENV` | `deployment.environment.name`. |

## Como funciona

- `api/src/instrumentation.ts` é carregado antes do servidor (`node --import ./dist/instrumentation.js dist/server.js`,
  no `CMD` do Dockerfile e no `npm start`). Se a telemetria estiver desligada, o arquivo não importa nada;
  `@opentelemetry/api` (usado pelos helpers) devolve tracer no-op.
- Falha ao iniciar o SDK só gera `console.warn`; a API sobe normalmente.
- Collector fora do ar não trava nem atrasa requests: export é assíncrono (fila de 4096 spans, descarta quando cheia,
  timeout de 10 s); os erros aparecem só no log do SDK (`ECONNREFUSED`).
- Instrumentação automática: HTTP de entrada (com `http.route` parametrizado), `fetch` de saída (undici, com
  propagação W3C `traceparent` para ravena-ai/jardim), Fastify (`@fastify/otel`: span `request`, `handler` e hook
  `preHandler`), ioredis, logs do pino com `trace_id`/`span_id`, métricas de runtime (event loop, GC, heap).
- Prisma: spans manuais `prisma {Model}.{operação}` via `$extends` (ver Limitações).
- Ignorados: `/health*`, `/favicon`, estáticos (`/media/`, `/css/`, `/js/`, `/vendor/`, `/assets/`, `/docs`).
- Helpers de spans de negócio em `api/src/telemetry.ts` (`withSpan`, `withBusinessSpan`, `setAttrs`, `addEvent`,
  `recordError`, `hashId`).

## Privacidade

- Usuário/grupo **só** como `waifu.user.id_hash` / `waifu.group.id_hash` (HMAC-SHA256 com `OTEL_ID_SALT`, 16 hex).
- Nunca em spans: ID cru, nome, texto de sugestão/motivo, prompt/resposta de LLM, chaves do Redis, segredos, headers.
- Redis grava só o nome do comando (`db.query.text = "get"`); chaves carregam token de sessão e userId.
- Prisma não grava args nem SQL.
- URLs: query com `key|token|auth|secret|password|signature|session` vira `REDACTED`/`***`, token do bot do Telegram
  no path vira `/bot{token}`, sequências de ≥ 6 dígitos viram `{n}`, `url.path` do Fastify sem query. O collector
  aplica a mesma máscara como segunda camada.
- Nome de personagem não é PII, mas é alta cardinalidade: não vira atributo.

## Spans de negócio

Atributos comuns aos 3 serviços: `app.outcome` = `ok | rejected | error` e `app.reject.reason` (enum curto, ex.:
`cooldown_active`, `claim_cooldown_active`, `insufficient_zinthos`). Rejeição de negócio (`DomainError` < 500 ou
`{ success: false, error.code }`) **não** marca status ERROR; exceção inesperada marca ERROR + `error.type` + exceção.
No `setErrorHandler`, respostas ≥ 500 marcam o span ativo como erro.

| Span | Atributos | Eventos |
|---|---|---|
| `roll` | `waifu.pool.size`, `waifu.pool.source` (memory/db/hub), `waifu.roll.rarity`, `waifu.roll.special`, `waifu.roll.jit_fetch`, `waifu.roll.free`, `waifu.roll.gender_filter` | `cooldown.consumed`, `cooldown.blocked`, `pool.loaded`, `cooldown.refunded` |
| `pool load` | `waifu.pool.size`, `waifu.pool.source` (no startup é raiz de trace próprio) | — |
| `marry` | `waifu.character.rarity`, `waifu.claim.lock_acquired` | `claim.lock_acquired`, `cooldown.rollback`, `claim.conflict` (`waifu.claim.conflict_code` = P2002/P2034/already_claimed), `tx.commit` |
| `divorce` | `waifu.character.rarity`, `waifu.divorce.soulmate`, `waifu.divorce.daily_number`, `waifu.divorce.soft_limit_applied` | `tx.commit` |
| `market offer.accept` | `waifu.market.external_items`, `waifu.market.compensated` | `lock.acquired`, `transfer.request`, `transfer.failed`, `tx.rollback`, `tx.commit`, `compensation.started/ok/failed` |
| `market offer.create` / `market offer.revert` | outcome | (chamada à ravena aparece como span CLIENT filho) |
| `suggestion submit` | `waifu.suggestion.type`, `waifu.upload.bytes` | — |
| `suggestion approve` / `suggestion approve.batch` | `waifu.suggestion.type` / `waifu.suggestion.batch_size` | — |
| `ai_advisor` | `gen_ai.operation.name=chat`, `gen_ai.provider.name=vllm`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens/output_tokens`, `waifu.ai.llm_calls`, `waifu.ai.tool_calls` | — |
| `ai_advisor lookup` | `waifu.ai.cache` (hit/miss), `waifu.ai.refresh` | — |
| `hosting_fee run` | `waifu.hosting.dry_run`, `force`, `users_evaluated`, `users_charged`, `already_charged`, `failed_users`, `waifus_confiscated` | — |

Falha da compensação do mercado (estorno externo não devolvido) sempre marca o span como ERROR
(`error.type=compensation_failed`): exige conferência manual.

## Consultas prontas no Jaeger (http://localhost:16686)

Service `waifuletes`, campo **Tags**:
- Rolls lentos: operação `roll`, *Min Duration* `200ms`.
- Rolls que carregaram o pool: `waifu.pool.source=db`.
- Mercado com compensação: operação `market offer.accept`, tags `waifu.market.compensated=true`.
- Erros reais (não rejeições): `app.outcome=error` ou `error=true`.
- Rejeições por motivo: `app.reject.reason=claim_cooldown_active`.
- Conselheiro de IA sem cache: `waifu.ai.cache=miss`.
- Todos os traces de um usuário: `waifu.user.id_hash=<hash>` (o mesmo hash na ravena-ai se o salt for igual).
- Rota HTTP: `http.route=/roll`.

Pelos logs: `docker logs waifuletes-api | grep <trace_id>` (linhas do pino carregam `trace_id`/`span_id`).

API do Jaeger 2.23 (a `/api/traces` legada não existe):
```bash
curl "localhost:16686/api/v3/traces?query.service_name=waifuletes&query.operation_name=roll&query.start_time_min=2026-11-14T00:00:00Z&query.start_time_max=2026-11-15T00:00:00Z"
```

## Limitações

- **Prisma**: `@prisma/instrumentation@5.22` depende do `sdk-trace-base` 1.x e derruba o processo com o SDK 2.x
  (`parentTracer.getSpanLimits is not a function`). Por isso não usamos o pacote nem `previewFeatures = ["tracing"]`;
  os spans `prisma {Model}.{op}` medem a chamada do client (inclui fila do pool de conexões), sem separar
  serialização/engine/SQL. `$queryRaw`/`$executeRaw` aparecem como `prisma $queryRaw`. Subir o Prisma resolve.
- O SDK está fixado na linha 0.223 / `@fastify/otel` 0.21.4 porque as versões novas exigem Node ≥ 22.15 (a imagem é Node 20).
- Overhead medido (200 requests sequenciais, local): rota barata `GET /user/:userId/cooldowns` ~+0,7 ms no p50 e
  ~+2,5 ms no p95 (gera ~10 spans de Redis por request); `POST /roll` sem diferença mensurável (variação do ruído).
- `pool load` disparado no startup é um trace raiz isolado (não há request pai).
- Métricas de negócio vêm do spanmetrics do collector (RED por span), não de contadores no app.
