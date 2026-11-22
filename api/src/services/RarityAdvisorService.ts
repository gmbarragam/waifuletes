import { config } from '../config.js';
import type { SuggestionNotifyData } from './TelegramNotificationService.js';
import type { Redis } from 'ioredis';
import { withBusinessSpan, setAttrs, setOutcome, recordError, activeSpan } from '../telemetry.js';

export interface RarityAdvisorEvaluation {
  response: string;
  systemPrompt: string;
  userPrompt: string;
  searchedQueries: string[];
  evaluatedAt: string;
  mudaeRank?: number | null;
  model?: string;
}

export type RarityAdvisorFailureCode =
  | 'AI_ADVISOR_NOT_CONFIGURED'
  | 'AI_ADVISOR_TIMEOUT'
  | 'AI_ADVISOR_EMPTY_RESPONSE'
  | 'AI_ADVISOR_HTTP_ERROR'
  | 'AI_ADVISOR_NETWORK_ERROR';

export interface RarityAdvisorError {
  code: RarityAdvisorFailureCode;
  message: string;
  statusCode: number;
}

export interface RarityAdvisorResult {
  evaluation: RarityAdvisorEvaluation | null;
  error?: RarityAdvisorError;
}

export class RarityAdvisorService {
  private url: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;
  private maxTokens: number;

  constructor() {
    this.url = config.HYPERION_LLM_URL;
    this.apiKey = config.HYPERION_LLM_KEY;
    this.model = config.HYPERION_LLM_MODEL;
    this.timeoutMs = config.HYPERION_LLM_TIMEOUT_MS;
    this.maxTokens = config.HYPERION_LLM_MAX_TOKENS;
  }

  /**
   * Realiza busca na web usando DuckDuckGo HTML e extrai resumos textuais
   */
  async searchWeb(query: string): Promise<string> {
    if (!query || typeof query !== 'string') {
      return 'Nenhum termo de pesquisa fornecido.';
    }

    const cleanQuery = query.trim();
    try {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.status !== 200) {
        throw new Error(`DuckDuckGo retornou HTTP ${res.status}`);
      }

      const html = await res.text();
      const regex = /<a[^>]+class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      let match: RegExpExecArray | null;
      const snippets: string[] = [];

      while ((match = regex.exec(html)) !== null && snippets.length < 4) {
        const cleaned = match[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .trim();
        if (cleaned) {
          snippets.push(cleaned);
        }
      }

      if (snippets.length > 0) {
        return snippets.map((s, idx) => `[${idx + 1}] ${s}`).join('\n\n');
      }
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Busca DuckDuckGo falhou (${err?.message || err}). Tentando Wikipedia...`);
    }

    // Fallback: Wikipedia OpenSearch API (PT e EN, removendo termos específicos do bot Mudae que poluem a busca enciclopédica)
    const wikiQuery = cleanQuery.replace(/\b(mudae|rank|kakera|waifuletes)\b/gi, '').replace(/\s+/g, ' ').trim() || cleanQuery;
    for (const lang of ['pt', 'en'] as const) {
      try {
        const wikiUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(wikiQuery)}&limit=3&namespace=0&format=json`;
        const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(5000) });
        if (wikiRes.ok) {
          const wikiData = (await wikiRes.json()) as any[];
          const titles = wikiData[1] || [];
          const descs = wikiData[2] || [];
          if (titles.length > 0) {
            return titles
              .map((t: string, i: number) => `[Wiki-${lang.toUpperCase()}] ${t}: ${descs[i] || 'Sem descrição'}`)
              .join('\n');
          }
        }
      } catch (_) {}
    }

    return 'Nenhum resultado relevante encontrado na pesquisa web.';
  }

  private cleanAniListDescription(raw?: string | null, maxLen = 420): string {
    if (!raw) return 'Sem descrição disponível.';
    const cleaned = raw
      .replace(/~!([\s\S]*?)!~/g, '') // remove blocos de spoiler do AniList
      .replace(/<[^>]+>/g, ' ')
      .replace(/__|\*\*|~~/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return 'Sem descrição disponível.';
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen).trim()}...` : cleaned;
  }

  /**
   * Consulta informações de anime/mangá (nota, popularidade, favoritos, estúdio, ano e sinopse) na API GraphQL do AniList.
   */
  async searchAnimeInfo(query: string): Promise<string> {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return 'Nenhum nome de anime/obra fornecido.';
    }
    const cleanQuery = query.trim();
    const gql = `
      query ($search: String) {
        Page(perPage: 3) {
          media(search: $search, sort: POPULARITY_DESC) {
            title { romaji english }
            type
            format
            status
            seasonYear
            episodes
            chapters
            averageScore
            popularity
            favourites
            genres
            studios(isMain: true) { nodes { name } }
            description(asHtml: false)
          }
        }
      }
    `;

    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: gql, variables: { search: cleanQuery } }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`AniList retornou HTTP ${res.status}`);
      }

      const json = (await res.json()) as any;
      const items: any[] = json?.data?.Page?.media || [];
      if (items.length === 0) {
        return `Nenhuma obra encontrada no AniList para "${cleanQuery}". Use web_search caso seja game, série ocidental, HQ ou outra mídia.`;
      }

      return items
        .map((m, idx) => {
          const title = m.title?.english && m.title.english !== m.title?.romaji
            ? `${m.title.romaji} (${m.title.english})`
            : m.title?.romaji || m.title?.english || 'Sem título';
          const studios = (m.studios?.nodes || []).map((s: any) => s.name).filter(Boolean).join(', ') || 'N/A';
          const genres = (m.genres || []).slice(0, 5).join(', ') || 'N/A';
          const lengthInfo = m.episodes ? `${m.episodes} eps` : m.chapters ? `${m.chapters} caps` : 'N/A';
          const score = m.averageScore != null ? `${m.averageScore}/100` : 'N/A';
          const pop = m.popularity != null ? m.popularity.toLocaleString('en-US') : 'N/A';
          const favs = m.favourites != null ? m.favourites.toLocaleString('en-US') : 'N/A';
          const desc = this.cleanAniListDescription(m.description, 300);
          return `[${idx + 1}] ${title} [${m.type || 'MEDIA'}/${m.format || 'N/A'}, ${m.seasonYear || 'N/A'}, ${lengthInfo}]\nEstúdio: ${studios} | Gêneros: ${genres}\nMétricas AniList: Nota ${score} | Popularidade: ${pop} usuários | Favoritos: ${favs}\nSinopse: ${desc}`;
        })
        .join('\n\n');
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Consulta AniList (anime) falhou (${err?.message || err}).`);
      return `Falha ao consultar AniList para "${cleanQuery}". Tente web_search se necessário.`;
    }
  }

  /**
   * Consulta informações do personagem (favoritos no AniList, obras em que aparece, papel MAIN/SUPPORTING/BACKGROUND e bio).
   */
  async searchCharacterInfo(name: string, series?: string): Promise<string> {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return 'Nenhum nome de personagem fornecido.';
    }
    const cleanName = name.trim();
    const cleanSeries = (series || '').trim().toLowerCase();
    const gql = `
      query ($search: String) {
        Page(perPage: 5) {
          characters(search: $search, sort: FAVOURITES_DESC) {
            name { full native alternative }
            favourites
            description(asHtml: false)
            media(perPage: 4, sort: POPULARITY_DESC) {
              edges {
                characterRole
                node {
                  title { romaji english }
                  type
                  seasonYear
                  popularity
                  favourites
                  averageScore
                }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: gql, variables: { search: cleanName } }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`AniList retornou HTTP ${res.status}`);
      }

      const json = (await res.json()) as any;
      let chars: any[] = json?.data?.Page?.characters || [];
      if (chars.length === 0) {
        return `Nenhum personagem encontrado no AniList para "${cleanName}". Use web_search caso seja de game, filme, série ocidental ou HQ.`;
      }

      if (cleanSeries) {
        const matchesSeries = (c: any) =>
          (c.media?.edges || []).some((e: any) => {
            const r = String(e.node?.title?.romaji || '').toLowerCase();
            const en = String(e.node?.title?.english || '').toLowerCase();
            return r.includes(cleanSeries) || en.includes(cleanSeries) || cleanSeries.includes(r);
          });
        const matched = chars.filter(matchesSeries);
        if (matched.length > 0) {
          chars = matched;
        }
      }

      return chars
        .slice(0, 3)
        .map((c, idx) => {
          const fullName = c.name?.full || cleanName;
          const alts = (c.name?.alternative || []).filter(Boolean).slice(0, 3).join(', ');
          const favs = c.favourites != null ? c.favourites.toLocaleString('en-US') : 'N/A';
          const roles = (c.media?.edges || [])
            .map((e: any) => {
              const t = e.node?.title?.romaji || e.node?.title?.english || 'Obra';
              const pop = e.node?.popularity != null ? `${e.node.popularity.toLocaleString('en-US')} users` : 'N/A';
              const score = e.node?.averageScore != null ? `nota ${e.node.averageScore}/100` : 'sem nota';
              return `${e.characterRole || 'N/A'} em "${t}" (${e.node?.type || 'MEDIA'}, ${e.node?.seasonYear || 'N/A'}, ${pop}, ${score})`;
            })
            .join('; ');
          const bio = this.cleanAniListDescription(c.description, 320);
          return `[${idx + 1}] ${fullName}${alts ? ` (Apelidos: ${alts})` : ''}\nFavoritos AniList: ${favs}\nPapéis em obras: ${roles || 'Não listado'}\nBio: ${bio}`;
        })
        .join('\n\n');
    } catch (err: any) {
      console.warn(`[RarityAdvisor] Consulta AniList (personagem) falhou (${err?.message || err}).`);
      return `Falha ao consultar AniList para o personagem "${cleanName}". Tente web_search se necessário.`;
    }
  }

  /**
   * Avalia a sugestão de raridade usando o modelo LLM configurado com ferramenta de busca web
   * e regras oficiais de Rank do Mudae (1-4466 = Lendário [2%], 4467-20701 = Épico [10%], 20702-62128 = Raro [20%], 62129-76135 = Incomum [28%], Acima de 76135 = Comum [40%])
   */
  async evaluateRaritySuggestion(data: SuggestionNotifyData, redis?: Redis): Promise<RarityAdvisorEvaluation | null> {
    const result = await this.evaluateRaritySuggestionDetailed(data, redis);
    return result.evaluation;
  }

  /**
   * Mesmo fluxo de evaluateRaritySuggestion, retornando também erro estruturado quando o modelo falha ou expira.
   */
  async evaluateRaritySuggestionDetailed(data: SuggestionNotifyData, redis?: Redis): Promise<RarityAdvisorResult> {
    if (!this.url || !this.model) {
      return {
        evaluation: null,
        error: {
          code: 'AI_ADVISOR_NOT_CONFIGURED',
          message: 'Serviço de IA não configurado no servidor (HYPERION_LLM_URL / HYPERION_LLM_MODEL).',
          statusCode: 503,
        },
      };
    }
    // Span GenAI: só metadados (modelo, tokens, nº de chamadas). Prompt/resposta NUNCA.
    const usage = { input: 0, output: 0, calls: 0, toolCalls: 0, retried: false, finishReason: undefined as string | undefined };
    return withBusinessSpan(
      'ai_advisor',
      {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'vllm',
        'gen_ai.request.model': this.model,
        'waifu.suggestion.type': data.type,
      },
      async (span) => {
        const result = await this.evaluateRaritySuggestionImpl(data, usage, redis);
        setAttrs(
          {
            'gen_ai.usage.input_tokens': usage.calls ? usage.input : undefined,
            'gen_ai.usage.output_tokens': usage.calls ? usage.output : undefined,
            'waifu.ai.llm_calls': usage.calls,
            'waifu.ai.tool_calls': usage.toolCalls,
            'waifu.ai.retry': usage.retried || undefined,
            'waifu.ai.finish_reason': usage.finishReason,
          },
          span
        );
        if (result.evaluation) {
          setOutcome('ok', undefined, span);
        } else if (!(span as any).attributes?.['app.outcome']) {
          const reason = result.error?.code === 'AI_ADVISOR_EMPTY_RESPONSE' ? 'empty_response' : 'unavailable';
          setOutcome('rejected', reason, span);
        }
        return result;
      }
    );
  }

  private trackUsage(
    usage: { input: number; output: number; calls: number; finishReason?: string },
    body: any
  ): string | undefined {
    usage.calls += 1;
    usage.input += Number(body?.usage?.prompt_tokens) || 0;
    usage.output += Number(body?.usage?.completion_tokens) || 0;
    const finishReason = body?.choices?.[0]?.finish_reason;
    if (finishReason) usage.finishReason = String(finishReason);
    const respModel = body?.model ? String(body.model) : undefined;
    if (respModel) setAttrs({ 'gen_ai.response.model': respModel });
    return respModel;
  }

  private isTimeoutError(err: any): boolean {
    if (!err) return false;
    const name = String(err.name || '');
    const msg = String(err.message || '').toLowerCase();
    return name === 'TimeoutError' || name === 'AbortError' || err.code === 23 || msg.includes('timeout') || msg.includes('aborted');
  }

  private async evaluateRaritySuggestionImpl(
    data: SuggestionNotifyData,
    usage: { input: number; output: number; calls: number; toolCalls: number; retried: boolean; finishReason?: string },
    redis?: Redis
  ): Promise<RarityAdvisorResult> {

    const charName = data.character?.name || data.characterName || 'Desconhecido';
    const series = data.character?.series || data.series || 'Desconhecida';
    const currentRarity = data.currentRarity || data.character?.baseRarity || 'COMMON';
    const suggestedRarity = data.suggestedRarity || 'COMMON';
    const reason = (data.reason || '').trim();
    const suggesterName = data.userName || 'Usuário Anônimo';
    const isMarried = Boolean(data.isMarriedToSuggester);
    const mudaeRank = data.character?.rank;

    let rankInfo = 'Não informado no banco de dados local (use as ferramentas para pesquisar popularidade e relevância)';
    if (mudaeRank && mudaeRank > 0) {
      if (mudaeRank <= 4466) {
        rankInfo = `#${mudaeRank} (Top ~4.466 ➔ Faixa de referência Mudae: LENDÁRIO)`;
      } else if (mudaeRank <= 20701) {
        rankInfo = `#${mudaeRank} (4.467 a 20.701 ➔ Faixa de referência Mudae: ÉPICO)`;
      } else if (mudaeRank <= 62128) {
        rankInfo = `#${mudaeRank} (20.702 a 62.128 ➔ Faixa de referência Mudae: RARO)`;
      } else if (mudaeRank <= 76135) {
        rankInfo = `#${mudaeRank} (62.129 a 76.135 ➔ Faixa de referência Mudae: INCOMUM)`;
      } else {
        rankInfo = `#${mudaeRank} (Acima de 76.135 ➔ Faixa de referência Mudae: COMUM)`;
      }
    }

    const systemPrompt = `Você é um analista perito em cultura pop, cultura geek, animes, games, HQs, séries e moderação de raridade para o jogo de coleção Waifuletes.

TABELA DE RARIDADES DO WAIFULETES E BALIZADOR DE RANK MUDAE:
- LEGENDARY (🟡 Lendário): O topo absoluto da cultura pop/geek/anime/games mundial. Ícones históricos, protagonistas lendários ou figuras com fandom global massivo e reconhecimento cultural duradouro.
  • Balizador Mudae (referência ~2%): Rank 1 a 4466.
- EPIC (🟣 Épico): Protagonistas muito famosos, personagens marcantes e ícones consagrados de obras de grande destaque, ou coadjuvantes extremamente populares de franquias gigantes.
  • Balizador Mudae (referência ~10%): Rank 4467 a 20701.
- RARE (🔵 Raro): Protagonistas de obras médias/de nicho popular, ou personagens principais de suporte em obras muito populares.
  • Balizador Mudae (referência ~20%): Rank 20702 a 62128.
- UNCOMMON (🟢 Incomum): Personagens secundários/coadjuvantes conhecidos em suas obras ou protagonistas de obras pouco conhecidas.
  • Balizador Mudae (referência ~28%): Rank 62129 a 76135.
- COMMON (⚪ Comum): Figurantes, personagens de fundo, NPCs menores ou personagens de obras muito obscuras.
  • Balizador Mudae (referência ~40%): Rank acima de 76135.

CRITÉRIOS DE AVALIAÇÃO (PONDERE OS 3 PILARES EM CONJUNTO):
1. BALIZADOR DO RANK MUDAE (Popularidade Geral no Gacha):
   - O Rank do Mudae serve como um **balizador inicial** de popularidade geral, mas **NÃO é uma regra rígida nem absoluta**.
   - Faixas de referência: 1 a 4466 (LEGENDARY), 4467 a 20701 (EPIC), 20702 a 62128 (RARE), 62129 a 76135 (UNCOMMON), acima de 76135 (COMMON).
   - Esteja atento a distorções do Mudae (ex.: ícones clássicos da cultura pop/geek ocidental, games ou animes antigos com rank modesto/ausente; ou personagens de hype temporário com rank inflado).
2. STATUS DO PERSONAGEM NA CULTURA POP E GEEK:
   - Avalie o peso cultural real do personagem: é um ícone reconhecível até fora do seu fandom? Tem papel principal (MAIN), secundário relevante (SUPPORTING) ou figurante (BACKGROUND)? Possui grande base de fãs (ex.: favoritos no AniList/MAL), memes marcantes, longevidade ou impacto geracional?
3. RELEVÂNCIA E IMPACTO DA OBRA (ANIME / GAME / SÉRIE / HQ):
   - Avalie a estatura da obra de origem: fenômeno global / clássico histórico (ex.: Dragon Ball, Naruto, One Piece, Frieren, Attack on Titan, Pokémon, Zelda, Star Wars), obra popular bem avaliada, obra de nicho médio ou título obscuro?
   - Use as ferramentas disponíveis (search_character_info, search_anime_info e web_search) sempre que precisar confirmar métricas da obra (popularidade, nota, favoritos), o papel real do personagem (MAIN vs SUPPORTING) ou checar se o usuário está falando a verdade.
4. CHECAGEM FACTUAL DE ALEGAÇÕES (FATO VS EXAGERO/MENTIRA):
   - Verifique se o motivo alegado pelo usuário é FATO comprovado ou se há EXAGERO/MENTIRA (ex.: fingir que um figurante é protagonista, exagerar a fama de uma obra de nicho, ou subestimar um ícone).
   - Quando o Rank Mudae divergir do peso pop/geek ou da relevância da obra, justifique claramente o peso dado a cada fator na raridade recomendada.
${isMarried ? '5. ⚠️ ATENÇÃO CRÍTICA: O usuário que fez o pedido é CASADO com esse personagem no jogo! Verifique com rigor redobrado se há viés de interesse próprio para valorizar sua própria waifu.' : ''}

FORMATO OBRIGATÓRIO DA RESPOSTA:
Emita seu parecer técnico objetivo em formato HTML para o Telegram e Painel Admin, seguindo RIGOROSAMENTE esta estrutura:
🤖 <b>Parecer da IA</b>:

🎯 <b>Veredito:</b> [PROCEDENTE | PARCIALMENTE PROCEDENTE | EXAGERO | FALSO/MENTIRA]
🏆 <b>Balizador Mudae:</b> [Ex: #842 (faixa de referência: Lendário) | Não informado no banco]
🌟 <b>Cultura Pop/Geek & Obra:</b> (relevância do anime/obra, papel do personagem e status na cultura pop/geek)
🔍 <b>Fatos Apurados:</b> (1 a 2 frases factuais sobre quem realmente é o personagem e seu papel na obra)
⚖️ <b>Checagem da Alegação:</b> (Análise se o motivo do usuário confere ou se está distorcido/falso)
💡 <b>Raridade Recomendada:</b> [COMMON | UNCOMMON | RARE | EPIC | LEGENDARY] (justificativa equilibrando Rank Mudae, status pop/geek e relevância da obra)`;

    const userPrompt = `Personagem: ${charName}
Série/Origem: ${series}
Raridade Atual: ${currentRarity}
Raridade Sugerida pelo Usuário: ${suggestedRarity}
Rank Mudae (Balizador): ${rankInfo}
Motivo alegado pelo usuário: "${reason || '(Nenhum motivo fornecido)'}"
Sugerido por: ${suggesterName}
Usuário é casado com o personagem?: ${isMarried ? 'SIM (Possível conflito de interesse)' : 'NÃO'}`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_character_info',
          description:
            'Consulta no AniList dados do personagem de anime/mangá: favoritos, obras em que aparece, papel real (MAIN, SUPPORTING ou BACKGROUND), popularidade da obra e biografia.',
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Nome do personagem (ex: "Frieren", "Rem", "Gojo Satoru", "Levi Ackerman")',
              },
              series: {
                type: 'string',
                description: 'Nome opcional do anime/mangá para desambiguar personagens homônimos (ex: "Re:Zero")',
              },
            },
            required: ['name'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_anime_info',
          description:
            'Consulta no AniList métricas de relevância de um anime ou mangá: nota média, número de usuários/popularidade, favoritos, estúdio, ano, episódios e sinopse.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Nome do anime ou mangá (ex: "Sousou no Frieren", "Naruto", "Bocchi the Rock")',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description:
            'Pesquisa na web/Wikipedia por informações biográficas, relevância na cultura pop/geek e popularidade (ideal para games, filmes, séries ocidentais, HQs ou quando não encontrado no AniList).',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Termo de pesquisa (ex: "Link Legend of Zelda", "Darth Vader Star Wars", "2B NieR Automata")',
              },
            },
            required: ['query'],
          },
        },
      },
    ];

    const searchedQueries: string[] = [];

    const buildAndCacheEvaluation = async (cleaned: string, resolvedModel?: string): Promise<RarityAdvisorResult> => {
      const evaluation: RarityAdvisorEvaluation = {
        response: cleaned,
        systemPrompt,
        userPrompt,
        searchedQueries,
        evaluatedAt: new Date().toISOString(),
        mudaeRank: mudaeRank || null,
        model: resolvedModel || this.model,
      };

      if (redis && data.id) {
        try {
          await redis.set(`suggestion:ai:${data.id}`, JSON.stringify(evaluation), 'EX', 30 * 86400);
        } catch (_) {}
      }

      return { evaluation };
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const callLlm = async (payload: Record<string, unknown>) => {
        return fetch(`${this.url}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      };

      // Chamada inicial (permite tool call de busca web)
      const res1 = await callLlm({
        model: this.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: this.maxTokens,
        temperature: 0.6,
      });

      if (!res1.ok) {
        const errText = await res1.text().catch(() => '');
        console.warn(`[RarityAdvisor] vLLM retornou HTTP ${res1.status} na chamada 1: ${errText.slice(0, 300)}`);
        recordError(activeSpan(), new Error(`HTTP ${res1.status}`), `http_${res1.status}`);
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_HTTP_ERROR',
            message: `O serviço de IA retornou erro HTTP ${res1.status}. Tente novamente em instantes.`,
            statusCode: 502,
          },
        };
      }

      const data1 = (await res1.json()) as any;
      let resolvedModel = this.trackUsage(usage, data1);
      const choice1 = data1.choices?.[0];
      if (!choice1?.message) {
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_EMPTY_RESPONSE',
            message: 'O modelo de IA retornou uma resposta vazia. Tente novamente.',
            statusCode: 502,
          },
        };
      }

      let finalChoice = choice1;

      // Se o modelo invocou ferramentas de busca, executa em paralelo e força resposta final sem novas tool calls
      if (choice1.message.tool_calls && choice1.message.tool_calls.length > 0) {
        usage.toolCalls += choice1.message.tool_calls.length;
        messages.push({
          role: 'assistant',
          content: choice1.message.content || null,
          tool_calls: choice1.message.tool_calls,
        });

        const toolCalls = choice1.message.tool_calls.slice(0, 4);
        const searchResults = await Promise.all(
          toolCalls.map(async (tc: any) => {
            const fnName = String(tc.function?.name || 'web_search');
            let args: Record<string, any> = {};
            try {
              args = JSON.parse(tc.function?.arguments || '{}') || {};
            } catch (_) {}

            if (fnName === 'search_character_info') {
              const targetName = String(args.name || args.query || charName);
              const targetSeries = args.series ? String(args.series) : series !== 'Desconhecida' ? series : undefined;
              searchedQueries.push(`[AniList Personagem] ${targetName}${targetSeries ? ` (${targetSeries})` : ''}`);
              const content = await this.searchCharacterInfo(targetName, targetSeries);
              return { tc, content };
            }

            if (fnName === 'search_anime_info') {
              const targetQuery = String(args.query || args.name || series);
              searchedQueries.push(`[AniList Obra] ${targetQuery}`);
              const content = await this.searchAnimeInfo(targetQuery);
              return { tc, content };
            }

            const query = String(args.query || `${charName} ${series}`);
            searchedQueries.push(`[Web] ${query}`);
            const content = await this.searchWeb(query);
            return { tc, content };
          })
        );

        for (const { tc, content } of searchResults) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function?.name || 'web_search',
            content,
          });
        }

        // Instrução explícita + tool_choice: 'none' evita que modelos com reasoning/tool-parser (ex: Qwen3/vLLM)
        // tentem emitir nova tool call quando não há mais rodadas de busca, o que fazia o vLLM devolver content: null.
        messages.push({
          role: 'user',
          content:
            'Com base nas informações acima e no seu conhecimento, emita agora o parecer final seguindo exatamente a estrutura HTML solicitada, sem chamar novas ferramentas.',
        });

        const res2 = await callLlm({
          model: this.model,
          messages,
          tools,
          tool_choice: 'none',
          max_tokens: this.maxTokens,
          temperature: 0.6,
        });

        if (!res2.ok) {
          const errText = await res2.text().catch(() => '');
          console.warn(`[RarityAdvisor] vLLM retornou HTTP ${res2.status} na chamada 2: ${errText.slice(0, 300)}`);
          recordError(activeSpan(), new Error(`HTTP ${res2.status}`), `http_${res2.status}`);
          return {
            evaluation: null,
            error: {
              code: 'AI_ADVISOR_HTTP_ERROR',
              message: `O serviço de IA retornou erro HTTP ${res2.status} ao finalizar o parecer. Tente novamente.`,
              statusCode: 502,
            },
          };
        }

        const data2 = (await res2.json()) as any;
        resolvedModel = this.trackUsage(usage, data2) || resolvedModel;
        finalChoice = data2.choices?.[0];
      }

      const rawContent = finalChoice?.message?.content?.trim() || null;
      let cleaned = rawContent ? this.cleanModelResponse(rawContent) : null;

      // Fallback defensivo: se o modelo ainda devolveu conteúdo vazio (ex: esgotou reasoning tokens ou tentou tool call bloqueada),
      // tenta mais uma vez de forma direta e concisa sem ferramentas.
      if (!cleaned) {
        console.warn(
          `[RarityAdvisor] Resposta vazia do modelo (${resolvedModel || this.model}, finish_reason=${finalChoice?.finish_reason || 'unknown'}, calls=${usage.calls}, out_tokens=${usage.output}). Tentando retry direto...`
        );
        usage.retried = true;
        const retryMessages = [
          ...messages,
          {
            role: 'user',
            content:
              'Responda de forma direta e concisa agora mesmo usando apenas o bloco HTML do parecer final (sem chamar ferramentas e sem raciocínio longo).',
          },
        ];
        const resRetry = await callLlm({
          model: this.model,
          messages: retryMessages,
          tools,
          tool_choice: 'none',
          max_tokens: this.maxTokens,
          temperature: 0.4,
        });

        if (resRetry.ok) {
          const dataRetry = (await resRetry.json()) as any;
          resolvedModel = this.trackUsage(usage, dataRetry) || resolvedModel;
          const retryRaw = dataRetry.choices?.[0]?.message?.content?.trim() || null;
          cleaned = retryRaw ? this.cleanModelResponse(retryRaw) : null;
        } else {
          const errText = await resRetry.text().catch(() => '');
          console.warn(`[RarityAdvisor] vLLM retornou HTTP ${resRetry.status} no retry: ${errText.slice(0, 300)}`);
        }
      }

      if (!cleaned) {
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_EMPTY_RESPONSE',
            message: 'O modelo de IA retornou uma resposta vazia. Tente consultar novamente.',
            statusCode: 502,
          },
        };
      }

      return buildAndCacheEvaluation(cleaned, resolvedModel);
    } catch (err: any) {
      const isTimeout = this.isTimeoutError(err);
      console.error('[RarityAdvisor] Erro na análise de raridade por LLM:', err?.message || err);
      recordError(activeSpan(), err, isTimeout ? 'timeout' : undefined);
      if (isTimeout) {
        return {
          evaluation: null,
          error: {
            code: 'AI_ADVISOR_TIMEOUT',
            message: `Tempo limite esgotado (${Math.round(this.timeoutMs / 1000)}s) ao aguardar resposta do modelo de IA. Tente novamente.`,
            statusCode: 504,
          },
        };
      }
      return {
        evaluation: null,
        error: {
          code: 'AI_ADVISOR_NETWORK_ERROR',
          message: 'Falha de comunicação com o serviço de IA. Tente novamente em instantes.',
          statusCode: 502,
        },
      };
    }
  }

  /**
   * Remove tokens residuais de thought/think e tags internas de canais do modelo
   */
  private cleanModelResponse(raw: string): string {
    return raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .replace(/<\|?channel\|?>thought[\s\S]*?<\|?channel\|?>/gi, '')
      .replace(/<\|?channel\|?>thought/gi, '')
      .replace(/<\|?channel\|?>/gi, '')
      .replace(/<\|.*?\|>/gi, '')
      .replace(/<\|.*?>/gi, '')
      .replace(/<.*?\|>/gi, '')
      .trim();
  }
}
