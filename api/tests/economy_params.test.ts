import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance } from 'fastify';

// A rota não toca no banco: o servidor de teste registra só o plugin de economia (com a mesma autenticação
// por API key da rota de resumo). A chave precisa existir antes de config.ts ser importado.
if (!process.env.API_KEYS && !process.env.API_KEY) {
  process.env.API_KEYS = 'test_key_economy_params_0123456789abcdef';
}
const API_KEY = process.env.API_KEY || (process.env.API_KEYS ? process.env.API_KEYS.split(',')[0].trim() : '');

const { privateEconomyRoutes } = await import('../src/routes/private/economy.js');
const { buildEconomyParams } = await import('../src/utils/economyParams.js');
const { config, activeHostingRates, inactiveHostingRates } = await import('../src/config.js');
const rarity = await import('../src/utils/rarityCalculator.js');
const cooldown = await import('../src/services/CooldownService.js');
const market = await import('../src/services/MarketInvestmentService.js');

const ROUTE = '/internal/economy/params';
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Arquivos de onde saem as constantes de balanceamento. Toda `export const NOME_EM_MAIUSCULAS` deles precisa
 * estar na rota ou em IGNORED_CONSTANTS; toda chave de config.ts, na rota ou em IGNORED_CONFIG_KEYS.
 */
const SOURCE_FILES = [
  'src/utils/rarityCalculator.ts',
  'src/services/CooldownService.ts',
  'src/services/MarketInvestmentService.ts',
  'src/services/HostingFeeService.ts',
  'src/config.ts',
];

const IGNORED_CONSTANTS: Record<string, string> = {
  ALL_RARITIES: 'lista das raridades (enum), não é valor de balanceamento',
};

const IGNORED_CONFIG_KEYS: Record<string, string> = {
  COOLDOWN_CLAIM_SECONDS_COMMON: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.COMMON',
  COOLDOWN_CLAIM_SECONDS_UNCOMMON: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.UNCOMMON',
  COOLDOWN_CLAIM_SECONDS_RARE: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.RARE',
  COOLDOWN_CLAIM_SECONDS_EPIC: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.EPIC',
  COOLDOWN_CLAIM_SECONDS_LEGENDARY: 'já exposto como claim.RARITY_CLAIM_COOLDOWNS.LEGENDARY',
  PORT: 'infraestrutura',
  HOST: 'infraestrutura',
  API_KEY: 'segredo',
  API_KEYS: 'segredo',
  ADMIN_PASSWORD: 'segredo',
  DATABASE_URL: 'URL com credencial',
  REDIS_URL: 'URL com credencial',
  CURRENCY_NAME: 'rótulo de exibição, não muda a economia',
  CURRENCY_EMOJI: 'rótulo de exibição, não muda a economia',
  INTERNAL_BASE_URL: 'URL',
  PUBLIC_BASE_URL: 'URL',
  RAVENA_API_URL: 'URL',
  MARKET_API_SECRET: 'segredo',
  JARDIM_API_URL: 'URL',
  TELEGRAM_BOT_TOKEN: 'segredo',
  TELEGRAM_CHAT_ID: 'identificador privado',
  TELEGRAM_WEBHOOK_SECRET: 'segredo',
  TELEGRAM_WEBHOOK_ALLOW_UNSIGNED: 'segurança do webhook, não muda a economia',
  HYPERION_LLM_URL: 'URL',
  HYPERION_LLM_KEY: 'segredo',
  HYPERION_LLM_MODEL: 'modelo do conselheiro de IA, não muda a economia',
  MEDIA_DIR: 'caminho local',
  CORS_ORIGINS: 'infraestrutura',
  ENABLE_SWAGGER: 'infraestrutura',
  EXTERNAL_USAGE_API: 'segredo (chaves da API externa)',
  EXTERNAL_USAGE_API_KEYS: 'segredo',
  UPSTREAM_API_URL: 'URL',
  UPSTREAM_API_KEY: 'segredo',
  REMOTE_MEDIA_BASE_URL: 'URL',
};

/** Achata como a rota: objetos viram NOME.CHAVE, arrays NOME.0, null vira "none". */
function flat(prefix: string, value: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value === null) out[prefix] = 'none';
  else if (Array.isArray(value)) value.forEach((v, i) => flat(`${prefix}.${i}`, v, out));
  else if (typeof value === 'object') for (const [k, v] of Object.entries(value as object)) flat(`${prefix}.${k}`, v, out);
  else out[prefix] = value;
  return out;
}

/** Nomes expostos: segundo segmento de `<grupo>.<NOME>[.<chave>]`. */
function exposedNames(params: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(params).map((k) => k.split('.')[1]));
}

describe('📐 GET /internal/economy/params — parâmetros de balanceamento (Zinthos)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    // EconomySummaryService só guarda o client; a rota de parâmetros não consulta o banco.
    app.decorate('prisma', {} as any);
    await app.register(privateEconomyRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (headers: Record<string, string> = { authorization: `Bearer ${API_KEY}` }) =>
    app.inject({ method: 'GET', url: ROUTE, headers });

  it('exige a API key (401 sem cabeçalho ou com chave errada)', async () => {
    expect((await get({})).statusCode).toBe(401);
    expect((await get({ authorization: 'Bearer chave_errada_000000000000000000' })).statusCode).toBe(401);
  });

  it('devolve o formato do contrato', async () => {
    const before = Date.now();
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['currency', 'generatedAt', 'params', 'schemaVersion', 'startedAt', 'version']);
    expect(body.currency).toBe('zinthos');
    expect(body.schemaVersion).toBe(1);
    expect(body.generatedAt).toBeGreaterThanOrEqual(before);
    expect(body.generatedAt).toBeLessThanOrEqual(Date.now());
    expect(Number.isInteger(body.startedAt)).toBe(true);
    expect(body.startedAt).toBeLessThanOrEqual(body.generatedAt);
    expect(body.version).toBe(process.env.GIT_SHA || process.env.APP_VERSION || null);

    const keys = Object.keys(body.params);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toEqual([...keys].sort());
    for (const [k, v] of Object.entries(body.params)) {
      expect(k).toMatch(/^[a-z]+\.[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)?$/);
      expect(['number', 'string', 'boolean']).toContain(typeof v);
      // Nada de segredo ou URL.
      expect(k).not.toMatch(/API_KEY|SECRET|TOKEN|PASSWORD|_URL/);
      if (typeof v === 'string') expect(v).not.toMatch(/:\/\//);
    }
  });

  it('valores iguais às constantes do código e ao config efetivo', async () => {
    const { params } = (await get()).json();
    const expected = {
      ...flat('roll.RARITY_BASE_WEIGHTS', rarity.RARITY_BASE_WEIGHTS),
      ...flat('roll.KAKERA_CRYSTAL_BASE', rarity.KAKERA_CRYSTAL_BASE),
      'roll.ROLL_MAX_BASE': config.ROLL_MAX_BASE,
      'roll.ROLL_REGEN_SECONDS': config.ROLL_REGEN_SECONDS,
      'roll.ROLL_REGEN_ACCEL_FACTOR': config.ROLL_REGEN_ACCEL_FACTOR,
      'roll.ROLL_LEGENDARY_CHANCE_CAP': config.ROLL_LEGENDARY_CHANCE_CAP,
      'roll.WEEKLY_LEGENDARY_HARD_CAP': config.WEEKLY_LEGENDARY_HARD_CAP,
      'roll.COOLDOWN_ROLL_SECONDS': config.COOLDOWN_ROLL_SECONDS,
      'roll.ROLL_SCRAP_BONUS_FACTOR': config.ROLL_SCRAP_BONUS_FACTOR,
      'roll.ROLL_SCRAP_BONUS_CAP': config.ROLL_SCRAP_BONUS_CAP,
      'roll.ROLL_RANK_MAX_DIFFICULTY': config.ROLL_RANK_MAX_DIFFICULTY,
      'roll.ROLL_RANK_REF_CUTOFF': config.ROLL_RANK_REF_CUTOFF,
      ...flat('claim.RARITY_CLAIM_COOLDOWNS', cooldown.RARITY_CLAIM_COOLDOWNS),
      'claim.COOLDOWN_CLAIM_SECONDS': config.COOLDOWN_CLAIM_SECONDS,
      'claim.CLAIM_LOCK_SECONDS': config.CLAIM_LOCK_SECONDS,
      'claim.SOULMATE_KEYS_REQUIRED': config.SOULMATE_KEYS_REQUIRED,
      'claim.WISHLIST_MAX_ITEMS': config.WISHLIST_MAX_ITEMS,
      'daily.DAILY_KAKERA_AMOUNT': config.DAILY_KAKERA_AMOUNT,
      'daily.DAILY_KAKERA_VARIANCE': config.DAILY_KAKERA_VARIANCE,
      'daily.DAILY_RESET_HOUR_UTC': config.DAILY_RESET_HOUR_UTC,
      'daily.DAILY_RESET_MINUTE_UTC': config.DAILY_RESET_MINUTE_UTC,
      'daily.COOLDOWN_DAILY_SECONDS': config.COOLDOWN_DAILY_SECONDS,
      ...flat('limits.RARITY_DAILY_MARRY_LIMITS', cooldown.RARITY_DAILY_MARRY_LIMITS),
      ...flat('limits.RARITY_DAILY_TRADE_LIMITS', cooldown.RARITY_DAILY_TRADE_LIMITS),
      ...flat('divorce.RARITY_DIVORCE_VALUES', rarity.RARITY_DIVORCE_VALUES),
      ...flat('divorce.RARITY_KEY_DIVORCE_BONUS', rarity.RARITY_KEY_DIVORCE_BONUS),
      ...flat('divorce.SOULMATE_DIVORCE_VALUES', rarity.SOULMATE_DIVORCE_VALUES),
      'divorce.SOULMATE_KEY_KAKERA_BONUS': rarity.SOULMATE_KEY_KAKERA_BONUS,
      'divorce.KEY_KAKERA_BONUS': rarity.KEY_KAKERA_BONUS,
      'divorce.DIVORCE_PENALTY_RATE': rarity.DIVORCE_PENALTY_RATE,
      ...flat('divorce.DAILY_DIVORCE_TIER_RATES', rarity.DAILY_DIVORCE_TIER_RATES),
      'divorce.DAILY_DIVORCE_MIN_RATE': rarity.DAILY_DIVORCE_MIN_RATE,
      'market.BASE_DAILY_ZINTHOS': market.BASE_DAILY_ZINTHOS,
      ...flat('market.RARITY_DAYS', market.RARITY_DAYS),
      'market.BASE_MONEY_SUPPLY': market.BASE_MONEY_SUPPLY,
      'market.INFLATION_ALPHA': market.INFLATION_ALPHA,
      ...flat('market.SCARCITY_BETA', market.SCARCITY_BETA),
      ...flat('market.MARRIED_KEY_PROGRESSION_WEIGHTS', rarity.MARRIED_KEY_PROGRESSION_WEIGHTS),
      'hosting.HOSTING_CONFISCO_PERMILLE': config.HOSTING_CONFISCO_PERMILLE,
      'hosting.HOSTING_GRACE_HOURS': config.HOSTING_GRACE_HOURS,
      ...flat('hosting.HOSTING_TAXAS_ATIVAS', activeHostingRates),
      ...flat('hosting.HOSTING_TAXAS_INATIVAS', inactiveHostingRates),
    };
    expect(params).toEqual(expected);
    // Amostras do formato pedido pelo painel.
    expect(params['divorce.DIVORCE_PENALTY_RATE']).toBe(rarity.DIVORCE_PENALTY_RATE);
    expect(params['divorce.DAILY_DIVORCE_TIER_RATES.0']).toBe(rarity.DAILY_DIVORCE_TIER_RATES[0]);
    expect(params['market.INFLATION_ALPHA']).toBe(market.INFLATION_ALPHA);
    expect(params['limits.RARITY_DAILY_MARRY_LIMITS.LEGENDARY']).toBe('none');
  });

  it('guarda: toda constante exportada dos arquivos de origem está na rota ou na lista de ignoradas', () => {
    const exposed = exposedNames(buildEconomyParams());
    const found = new Set<string>();
    for (const file of SOURCE_FILES) {
      const src = readFileSync(path.join(API_DIR, file), 'utf8');
      for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]+)/g)) found.add(m[1]);
    }
    const missing = [...found].filter((n) => !exposed.has(n) && !(n in IGNORED_CONSTANTS));
    expect(missing, 'constante nova: exponha em utils/economyParams.ts ou ignore aqui com o motivo').toEqual([]);
    // Lista de ignoradas sem entradas velhas.
    expect(Object.keys(IGNORED_CONSTANTS).filter((n) => !found.has(n))).toEqual([]);
  });

  it('guarda: toda chave de config.ts está na rota ou na lista de ignoradas', () => {
    const exposed = exposedNames(buildEconomyParams());
    // Chaves do envSchema (opcionais sem valor não aparecem em Object.keys(config)).
    const src = readFileSync(path.join(API_DIR, 'src/config.ts'), 'utf8');
    const keys = [...src.matchAll(/^ {2}([A-Z][A-Z0-9_]+): z\./gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(30);
    const missing = keys.filter((k) => !exposed.has(k) && !(k in IGNORED_CONFIG_KEYS));
    expect(missing, 'variável nova em config.ts: exponha em utils/economyParams.ts ou ignore aqui com o motivo').toEqual([]);
    expect(Object.keys(IGNORED_CONFIG_KEYS).filter((k) => exposed.has(k))).toEqual([]);
  });
});
