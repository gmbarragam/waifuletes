# Observabilidade (OpenTelemetry)

O waifuletes exporta **traces** e **métricas** via OTLP/HTTP para o stack de observabilidade do
ecossistema Ravena. A telemetria é **opcional** e fica **desligada por padrão**.

## Como ligar

1. Suba o backend (uma vez, no host), que fica no repositório da ravena:
   ```bash
   cd ravena-ai/observability && docker compose up -d
   ```
   Collector OTLP/HTTP em `:4318` (o gRPC `:4317` não é publicado; o exporter do waifuletes é `otlp-proto` via HTTP), Jaeger em http://localhost:16686, Grafana em http://localhost:3001.
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
  timeout de 10 s); os erros aparecem só no log do SDK, numa linha curta sem stack (ex.:
  `[otel] ECONNREFUSED connect ECONNREFUSED ...`) e no máximo 1 vez por minuto por tipo de mensagem.
- Instrumentação automática: HTTP de entrada (com `http.route` parametrizado), `fetch` de saída (undici, com
  propagação W3C `traceparent` para ravena-ai/jardim), Fastify (`@fastify/otel`: span `request`, `handler` e hook
  `preHandler`), ioredis, logs do pino com `trace_id`/`span_id`, métricas de runtime (event loop, GC, heap).
- Prisma: spans manuais `prisma {Model}.{operação}` via `$extends` (ver Limitações).
- Ignorados: `/health*`, `/favicon`, estáticos (`/media/`, `/css/`, `/js/`, `/vendor/`, `/assets/`, `/docs`).
- Helpers de spans de negócio em `api/src/telemetry.ts` (`withSpan`, `withBusinessSpan`, `setAttrs`, `addEvent`,
  `recordError`, `hashUserId`, `hashId`, `setRequestAttrs`).

## Privacidade

- Usuário/grupo **só** como `waifu.user.id_hash` / `waifu.group.id_hash` (HMAC-SHA256 com `OTEL_ID_SALT`, 16 hex).
  Usuário via `hashUserId` (corta no primeiro `@` e no primeiro `:`, igual à ravena-ai); grupo via `hashId` do ID completo.
  Mercado também grava `waifu.buyer.id_hash`/`waifu.seller.id_hash`.
- Hook global `preValidation` (server.ts) grava os hashes de `userId`/`groupId` (params, corpo ou query) no span
  SERVER e no `request` de toda rota, inclusive as sem span de negócio.
- Nunca em spans: ID cru, nome, texto de sugestão/motivo, prompt/resposta de LLM, chaves do Redis, segredos, headers.
- Redis grava só o nome do comando (`db.query.text = "get"`); chaves carregam token de sessão e userId.
- Prisma não grava args nem SQL.
- URLs (`api/src/telemetryUrl.ts`, aplicado por um SpanProcessor antes do export):
  - servidor: `url.path` = `http.route` (ex.: `/user/:userId/cooldowns`); sem rota (404) só o 1º segmento literal
    fica, o resto vira `{id}`. `url.query` por allowlist (`limit`, `page`, `sort`, `rarity`, `gender`, `status`, ...);
    os demais (`search`, `series`, `tag`, `userId`, `token`, `publicId`, ...) viram `REDACTED`;
  - cliente (fetch para ravena/JDS/Hub/Telegram/LLM): `url.full` = origem + caminho com todo segmento que não seja
    literal conhecido trocado por `{id}` (ex.: `/api/market/user-inventory/{id}`), sem query; token do bot do
    Telegram vira `/bot{token}`.
  O collector aplica máscara equivalente como segunda camada.
- Exceções de 4xx (`DomainError`, validação do Fastify, qualquer `statusCode` < 500) gravadas pelo `@fastify/otel`
  ficam só com `exception.type` = código (ex.: `COLLECTION_NOT_FOUND`); mensagem e stack (que carregam input do
  usuário) não são gravadas. Erros ≥ 500 continuam com mensagem e stack.
- Nome de personagem não é PII, mas é alta cardinalidade: não vira atributo.

## Spans de negócio

Atributos comuns aos 3 serviços: `app.outcome` = `ok | rejected | error` e `app.reject.reason` (enum curto, ex.:
`cooldown_active`, `claim_cooldown_active`, `insufficient_zinthos`). Rejeição de negócio (`DomainError` < 500 ou
`{ success: false, error.code }`) **não** marca status ERROR; exceção inesperada marca ERROR + `error.type` + exceção.
No `setErrorHandler`, respostas ≥ 500 marcam o span ativo como erro.

Status dos spans do `@fastify/otel` (`request`, `handler - *`, `preHandler - *`): o plugin marca ERROR em todo erro
lançado, inclusive 4xx de negócio. O SpanProcessor de normalização (`instrumentation.ts`) devolve para UNSET quando o
status HTTP (ou o `statusCode` do erro, no `handler`) é < 500, e remove `http.response.status_code` do span interno
`request` nos 4xx (o Jaeger deriva ERROR de spans INTERNAL com código 4xx; o código continua no span SERVER
`POST /rota`). 5xx continuam ERROR.

| Span | Atributos | Eventos |
|---|---|---|
| `roll` (filhos: `roll cooldown.consume`/`cooldown.check`, `roll context.load`, `roll pool.select` — filtragem + pesos + sorteio em CPU sobre o pool em memória, com `waifu.roll.candidates`/`special_candidates` —, `roll candidate.load` — inclui JIT do Hub —, `roll wishlist.group`, `roll claim.process`, `roll reward.apply`, `roll daily_limit.check`) | `waifu.pool.size`, `waifu.pool.source` (memory/db/hub), `waifu.roll.rarity`, `waifu.roll.special`, `waifu.roll.jit_fetch`, `waifu.roll.free`, `waifu.roll.gender_filter` | `cooldown.consumed`, `cooldown.blocked`, `pool.loaded`, `cooldown.refunded` |
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
- Redis: `get`/`ttl` são ~metade dos spans. O `@opentelemetry/instrumentation-ioredis` 0.71 não tem opção para
  pular comandos de pipeline/multi (só prefixa o nome); o corte fica no collector (`filter/fast-redis`, spans Redis
  < 1 ms).
