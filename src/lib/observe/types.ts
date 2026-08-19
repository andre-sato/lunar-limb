/**
 * Documentation Observability — modelo (P3.2).
 *
 * A pergunta muda de *"a documentação está correta?"* para *"a documentação
 * resolve o problema de quem chegou aqui?"*. Responder isso exige observar
 * leitores, e é aí que a camada pode causar dano — então a decisão de privacidade
 * vem antes do primeiro tipo, e não como um apêndice:
 *
 * **Nada que identifique uma pessoa é gravado.** Não há IP, não há user-agent,
 * não há id de usuário, não há cookie persistente. O que existe é um
 * identificador de sessão efêmero, gerado no navegador, que só serve para
 * costurar uma jornada dentro da mesma visita e some quando a aba fecha.
 *
 * E o texto da busca continua desligado por padrão, como já estava no resto do
 * portal: `storeUnansweredQuestions: false` no `health.yml`. Sem ele a camada
 * ainda mede taxa de sucesso, abandono e jornada — ela só não sabe *o que* foi
 * perguntado.
 */

export type ObservedEventType =
	| 'page-view'
	| 'search'
	| 'search-click'
	| 'example-copy'
	| 'page-exit'
	| 'feedback';

/**
 * Um evento observado.
 *
 * O que **não** está aqui é tão deliberado quanto o que está: sem `ip`, sem
 * `userId`, sem `userAgent`, sem `referrer` externo. Cada campo a mais seria um
 * campo a proteger, e nenhum deles muda a resposta que a camada existe para dar.
 */
export interface ObservedEvent {
	type: ObservedEventType;
	/** Página, relativa a `src/content/docs`. Ausente em busca sem resultado. */
	path?: string;
	/** Sessão efêmera. Some quando a aba fecha; nunca liga duas visitas. */
	session: string;
	/** Epoch em milissegundos, arredondado para o minuto. */
	at: number;
	/** Quantos resultados a busca devolveu. Só para `search`. */
	results?: number;
	/** Segundos na página. Só para `page-exit`. */
	dwellSeconds?: number;
	/**
	 * Texto da consulta, **somente** quando o portal está configurado para
	 * guardá-lo. Ausente é o padrão.
	 */
	query?: string;
	/** `up` ou `down`. Só para `feedback`. */
	vote?: 'up' | 'down';
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

export interface PageMetrics {
	path: string;
	views: number;
	/** Sessões distintas — não visitas. */
	readers: number;
	/** Mediana de segundos na página, quando há saída registrada. */
	medianDwellSeconds: number | null;
	/** Sessões que chegaram por busca e saíram do portal sem abrir outra página. */
	exits: number;
	up: number;
	down: number;
}

export interface SearchMetrics {
	/** Buscas totais no período. */
	searches: number;
	/** Buscas que não devolveram resultado nenhum. */
	zeroResult: number;
	/** Buscas seguidas de clique num resultado. */
	clicked: number;
	/** Buscas seguidas de outra busca na mesma sessão. */
	refined: number;
	/** Buscas que não levaram a clique nem a refinamento. */
	abandoned: number;
	/**
	 * Clique sobre busca com resultado. **Não** é "o leitor resolveu o problema":
	 * clicar é o mais longe que a instrumentação enxerga, e chamar isso de sucesso
	 * já seria uma inferência. O nome carrega o limite.
	 */
	clickThroughRate: number | null;
	zeroResultRate: number | null;
	refinementRate: number | null;
	abandonmentRate: number | null;
}

export interface JourneyStep {
	path: string;
	/** Quantas sessões seguiram este caminho. */
	sessions: number;
}

export interface Journey {
	/** A sequência de páginas, na ordem. */
	steps: string[];
	sessions: number;
	/** Fração das sessões desta jornada que terminaram sem clique nem voto positivo. */
	abandonmentRate: number;
}

/**
 * Uma lacuna sugerida pelo comportamento, não pelo texto.
 *
 * `confidence` é o quanto o sinal sustenta a hipótese — nunca a probabilidade de
 * a lacuna existir. Uma busca abandonada dez vezes é evidência de atrito; pode
 * ser conteúdo faltando, título ruim, ou dez pessoas que acharam a resposta no
 * trecho da busca e não precisaram abrir a página.
 */
export interface BehavioralGap {
	/** O termo, quando o portal guarda texto; senão, a página de origem. */
	topic: string;
	signal: 'zero-result' | 'abandoned-search' | 'high-exit' | 'negative-feedback';
	occurrences: number;
	confidence: number;
	evidence: string[];
}

export interface ObservabilityReport {
	pages: PageMetrics[];
	search: SearchMetrics;
	journeys: Journey[];
	gaps: BehavioralGap[];
	/** Sessões distintas no período. */
	sessions: number;
	/** Janela analisada, em dias. */
	windowDays: number;
	/**
	 * `true` quando a leitura está limitada — coleta desligada, texto de busca não
	 * guardado, ou volume abaixo do limiar de agregação. O relatório sempre diz
	 * quando não pode concluir, em vez de mostrar um número pequeno como se fosse
	 * a realidade.
	 */
	limited: boolean;
	limitations: string[];
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface ObservabilityConfig {
	enabled: boolean;
	/** Dias de retenção. Evento mais velho que isso é apagado na próxima escrita. */
	retentionDays: number;
	/**
	 * Mínimo de sessões distintas para uma linha aparecer no relatório.
	 *
	 * Com 3, uma página visitada por uma pessoa não vira uma linha que a
	 * identifica para quem conhece a equipe. É o limiar que transforma observação
	 * em estatística.
	 */
	minimumSessions: number;
	/** Guardar o texto das buscas. Desligado por padrão, como no resto do portal. */
	storeQueryText: boolean;
	/** Janela padrão dos relatórios, em dias. */
	windowDays: number;
}

export const DEFAULT_OBSERVABILITY: ObservabilityConfig = {
	enabled: true,
	retentionDays: 90,
	minimumSessions: 3,
	storeQueryText: false,
	windowDays: 30,
};
