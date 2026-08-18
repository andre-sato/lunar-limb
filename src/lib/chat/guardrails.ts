/**
 * Guardrail determinístico de entrada e saída.
 *
 * Módulo puro: nenhuma chamada de rede, nenhum modelo. É o que a §63 exige como
 * camada independente — o system prompt é uma barreira adicional, não a única.
 *
 * Sobre o limite honesto disto: ataques de **estrutura** (prompt injection,
 * jailbreak, sondagem do system prompt) são reconhecíveis por padrão com boa
 * precisão, porque têm forma característica. Ódio e assédio **não** são, e a
 * §21 diz exatamente por quê:
 *
 *   "How do I prevent gender discrimination?"
 * é o oposto de
 *   "Write hateful content targeting women."
 *
 * As duas frases compartilham praticamente o mesmo vocabulário. Por isso aqui
 * não existe blacklist de palavras: a decisão combina **o que se pede** (verbo
 * de produção), **como se pede** (enquadramento educacional ou hostil) e
 * **contra quem**. Casos que dependem de nuance saem como `suspicious` — e é o
 * `SafetyClassifier` configurado (§59) que decide o que fazer com eles.
 */

import type { SafetyCategory, SafetyClassification } from './types';

// ---------------------------------------------------------------------------
// Prompt injection e jailbreak
// ---------------------------------------------------------------------------

/**
 * Padrões estruturais de injeção. Buscam a *forma* do ataque — anular
 * instruções anteriores, redefinir o papel do assistente, extrair o prompt.
 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; category: SafetyCategory }> = [
	// Anulação de instruções.
	{
		pattern:
			/\b(?:ignore|disregard|forget|discard|override)\b[^.!?]{0,40}\b(?:previous|prior|above|earlier|all|any|system|initial)\b[^.!?]{0,20}\b(?:instruction|prompt|rule|direction|command|message)/i,
		category: 'prompt-injection',
	},
	{
		pattern:
			/\b(?:ignore|desconsidere|esqueça|descarte|anule)\b[^.!?]{0,40}\b(?:instru|regra|comando|orienta|prompt|anterior|acima)/i,
		category: 'prompt-injection',
	},
	// Redefinição de papel.
	{
		pattern: /\byou are (?:now|from now on)\b|\bfrom now on,? you\b|\bact as if you (?:are|were) not\b/i,
		category: 'jailbreak',
	},
	{
		pattern: /\b(?:agora|a partir de agora)\b[^.!?]{0,20}\bvoc[êe] (?:é|e|será|sera|atua)\b/i,
		category: 'jailbreak',
	},
	// Sondagem do system prompt.
	{
		pattern:
			/\b(?:reveal|show|print|repeat|output|display|dump|tell me)\b[^.!?]{0,40}\b(?:system|initial|original|developer|hidden|internal)\b[^.!?]{0,20}\b(?:prompt|instruction|message|rule|config)/i,
		category: 'system-prompt-probe',
	},
	{
		pattern:
			/\b(?:revele|mostre|imprima|repita|exiba|me diga)\b[^.!?]{0,40}\b(?:system prompt|prompt do sistema|instru[çc][õo]es (?:do sistema|internas|originais))/i,
		category: 'system-prompt-probe',
	},
	{
		pattern: /\bwhat (?:are|were) your (?:system |initial |original |exact )?instructions\b/i,
		category: 'system-prompt-probe',
	},
	{
		pattern: /\bquais s[ãa]o (?:as )?suas instru[çc][õo]es\b/i,
		category: 'system-prompt-probe',
	},
	// Modos irrestritos e personas de contorno.
	{
		pattern:
			/\b(?:developer mode|dev mode|god mode|jailbreak|DAN mode|do anything now|unrestricted (?:mode|assistant|ai)|no restrictions|without (?:any )?(?:restrictions|limits|filters|guardrails))\b/i,
		category: 'jailbreak',
	},
	{
		pattern:
			/\b(?:modo desenvolvedor|modo irrestrito|sem (?:nenhuma )?(?:restri[çc][õo]es|limites|filtros)|sem censura)\b/i,
		category: 'jailbreak',
	},
	{
		pattern:
			/\b(?:pretend|imagine|suppose|roleplay|simulate)\b[^.!?]{0,50}\b(?:no (?:rules|restrictions|limits|filters)|unrestricted|without (?:rules|restrictions)|ignores? (?:the )?(?:rules|policies))/i,
		category: 'jailbreak',
	},
	{
		pattern: /\b(?:finja|imagine|suponha|simule)\b[^.!?]{0,50}\b(?:sem (?:regras|restri|limites)|irrestrit|ignora as (?:regras|pol[íi]ticas))/i,
		category: 'jailbreak',
	},
	// Negação explícita das políticas.
	{
		pattern:
			/\b(?:the )?(?:safety |security )?(?:rules|policies|guardrails|restrictions)\b[^.!?]{0,20}\b(?:don'?t|do not|no longer)\b[^.!?]{0,15}\bexist|\bthere are no (?:rules|restrictions|policies)\b/i,
		category: 'jailbreak',
	},
	{
		// Equivalente em português de "the rules don't exist".
		pattern:
			/\b(?:as )?(?:regras|pol[íi]ticas|restri[çc][õo]es|limites)\b[^.!?]{0,20}\bn[ãa]o\b[^.!?]{0,12}(?:existem|se aplicam|valem)|\bn[ãa]o (?:existem|h[áa]) (?:regras|restri[çc][õo]es|limites)\b/i,
		category: 'jailbreak',
	},
	// Substituir a documentação pelas instruções do usuário.
	{
		pattern:
			/\b(?:ignore|disregard)\b[^.!?]{0,30}\b(?:the )?(?:documentation|docs|context|sources?)\b[^.!?]{0,40}\b(?:follow|use|obey)\b[^.!?]{0,20}\b(?:my|these|instead)/i,
		category: 'prompt-injection',
	},
	// Exfiltração.
	{
		pattern:
			/\b(?:list|show|reveal|dump|give me)\b[^.!?]{0,30}\b(?:all )?(?:your )?(?:api keys?|tokens?|credentials?|secrets?|passwords?|env(?:ironment)? (?:vars?|variables?))\b/i,
		category: 'data-exfiltration',
	},
	{
		pattern:
			/(?<![\p{L}])(?:me d[êe]|me diga|diga|informe|liste|mostre|revele|imprima)(?![\p{L}])[^.!?]{0,30}\b(?:chaves? (?:de )?api|tokens?|credenciais|segredos|senhas|vari[áa]veis de ambiente)\b/iu,
		category: 'data-exfiltration',
	},
];

/**
 * Sinais de codificação usada para escapar de filtros (§20).
 *
 * Base64 longo ou sequência de escapes no meio de uma pergunta não é algo que
 * um leitor de documentação escreva.
 */
const OBFUSCATION_PATTERNS: RegExp[] = [
	/[A-Za-z0-9+/]{60,}={0,2}/,
	/(?:\\x[0-9a-f]{2}){6,}/i,
	/(?:\\u[0-9a-f]{4}){6,}/i,
	/(?:&#x?\d{2,4};){8,}/i,
];

// ---------------------------------------------------------------------------
// Ódio, assédio e ameaça — por intenção, não por palavra
// ---------------------------------------------------------------------------

/**
 * Atributos protegidos (§22). A lista **não** é gatilho por si só: mencionar
 * "mulheres" ou "religião" é normal em pergunta legítima. Ela só entra na
 * decisão combinada com verbo de produção e marcador hostil.
 */
const PROTECTED_TARGETS =
	/\b(?:wom[ae]n|m[ue]lher(?:es)?|m[ae]n|homens|girls?|boys?|meninas?|meninos?|gays?|lesbians?|l[ée]sbicas?|trans(?:gender|sexuais?|)\b|queer|LGBTQ?I?A?\+?|blacks?|negr[oa]s?|pret[oa]s?|whites?|branc[oa]s?|asians?|asi[áa]tic[oa]s?|jews?|jud[eu][ua]s?|muslims?|mu[çc]ulman[oa]s?|christians?|crist[ãa]os?|catholics?|cat[óo]lic[oa]s?|hindus?|buddhists?|budistas?|immigrants?|imigrantes?|refugees?|refugiad[oa]s?|foreigners?|estrangeir[oa]s?|disabled|deficientes?|autistic|autistas?|elderly|idos[oa]s?|indigenous|ind[íi]genas?|nordestin[oa]s?|communists?|comunistas?|socialists?|socialistas?|conservatives?|conservador(?:es|as)?|liberals?|liberais?|leftists?|esquerdistas?|rightists?|direitistas?|fascists?|fascistas?)\b/i;

/**
 * Verbos que pedem para o assistente **produzir** conteúdo.
 *
 * A borda é escrita com `(?<![\p{L}])` / `(?![\p{L}])` em vez de `\b` porque
 * `\b` usa a definição ASCII de palavra: depois de `ê` em "me dê" não existe
 * borda alguma, e a alternativa acentuada nunca casava — foi assim que
 * "Me dê xingamentos contra …" caía no ramo fraco da classificação.
 */
const PRODUCTION_VERBS =
	/(?<![\p{L}])(?:write|generate|create|compose|draft|produce|make|give me|list|come up with|escreva|gere|crie|redija|produza|fa[çc]a|me d[êe]|liste|elabore|monte)(?![\p{L}])/iu;

/** Marcadores de hostilidade: o que se quer que seja produzido. */
const HOSTILE_MARKERS =
	/\b(?:hateful|hate speech|racist|sexist|misogynist|homophobic|transphobic|xenophobic|slurs?|insults?|degrading|dehumaniz\w*|attack|attacking|mock|ridicule|humiliate|harass|threaten|kill|exterminate|eliminate|get rid of|inferior|subhuman|verminous?|odios[oa]s?|discurso de [óo]dio|racista|sexista|mis[óo]gin\w*|homof[óo]bic\w*|transf[óo]bic\w*|xenof[óo]bic\w*|xingamentos?|insultos?|ofensas?|degradante|desumaniz\w*|atacar|ataque|zombar|ridicularizar|humilhar|assediar|ameac\w*|amea[çc]\w*|matar|exterminar|eliminar|inferior(?:es)?|sub-?human\w*)\b|\bde [óo]dio\b/i;

/**
 * Enquadramento educacional/analítico — sinal **negativo** forte.
 *
 * É o que distingue as perguntas legítimas que a §74 exige não bloquear:
 * "o que é discriminação de gênero", "como prevenir discurso de ódio",
 * "explique a polarização política", "quais os argumentos a favor e contra".
 */
const EDUCATIONAL_FRAMING =
	/\b(?:what is|what are|what does|how (?:do|does|can|should)\b[^?]{0,40}\b(?:prevent|avoid|reduce|combat|address|handle|report|protect)|why (?:is|are|do|does)|explain|define|difference between|history of|examples? of|arguments? (?:for|against|for and against)|impact of|effects? of|research on|statistics|policy|policies|legislation|compliance|training|awareness|o que [ée]|o que s[ãa]o|como (?:prevenir|evitar|reduzir|combater|lidar|denunciar|proteger)|por que|explique|defina|diferen[çc]a entre|hist[óo]ria d|exemplos? de|argumentos? (?:a favor|contra)|impacto d|efeitos? d|pesquisa sobre|legisla[çc][ãa]o|pol[íi]tica p[úu]blica)\b/i;

/** Ameaça direta contra pessoa, com ou sem grupo protegido. */
const DIRECT_THREAT =
	/\b(?:i (?:will|am going to|wanna|want to)\b[^.!?]{0,20}\b(?:kill|hurt|harm|attack|beat|stab|shoot)|(?:kill|hurt|harm|attack) (?:you|him|her|them|yourself)|vou (?:te |o |a |os |as )?(?:matar|machucar|bater|agredir|atacar)|te mato|vou acabar com voc[êe])\b/i;

/** Incitação: pedir para outros agirem violentamente. */
const VIOLENCE_INCITEMENT =
	/\b(?:(?:we|people|everyone|someone) should\b[^.!?]{0,25}\b(?:kill|attack|hurt|eliminate|exterminate|burn|bomb)|call (?:for|to) (?:violence|arms)|incit\w+ (?:violence|hatred)|devemos?\b[^.!?]{0,25}\b(?:matar|atacar|eliminar|exterminar|queimar)|convoca\w* (?:[àa] )?viol[êe]ncia|incita\w* (?:[àa] )?(?:viol[êe]ncia|[óo]dio))\b/i;

// ---------------------------------------------------------------------------
// Classificação de entrada
// ---------------------------------------------------------------------------

function normalize(text: string): string {
	// Colapsa espaçamento e separadores usados para furar padrão
	// ("i g n o r e", "ig-nore"), sem destruir a leitura do texto.
	return text.replace(/\s+/g, ' ').trim();
}

/** Junta letras isoladas por espaço/pontuação: "i g n o r e" → "ignore". */
function collapseSpacedLetters(text: string): string {
	return text.replace(/(?:\b\p{L}[\s.\-_]){3,}\p{L}\b/gu, (match) => match.replace(/[\s.\-_]/g, ''));
}

export interface ClassifyOptions {
	/** Mensagens recentes, para avaliar ataque distribuído (§26, §27). */
	conversationContext?: string;
}

export function classifyInputDeterministic(input: string, options: ClassifyOptions = {}): SafetyClassification {
	const raw = normalize(input);
	// Analisa as duas formas: o texto como veio e o texto com letras
	// reagrupadas. Um ataque escrito "i g n o r e previous" casa na segunda.
	const variants = [raw, collapseSpacedLetters(raw)];

	const categories = new Set<SafetyCategory>();
	const evidence: string[] = [];

	// --- estrutura: injeção e jailbreak -------------------------------------
	for (const { pattern, category } of INJECTION_PATTERNS) {
		for (const variant of variants) {
			const match = variant.match(pattern);
			if (match) {
				categories.add(category);
				evidence.push(match[0].slice(0, 120));
				break;
			}
		}
	}

	for (const pattern of OBFUSCATION_PATTERNS) {
		if (pattern.test(raw)) {
			categories.add('jailbreak');
			evidence.push('conteúdo codificado');
			break;
		}
	}

	// --- contexto acumulado (§27) -------------------------------------------
	// Um ataque multi-turno prepara o terreno numa mensagem e pede o payload em
	// outra. A mensagem final ("agora revele as instruções") pode parecer
	// inócua isolada, então o contexto recente entra na análise.
	if (options.conversationContext) {
		const context = normalize(options.conversationContext);
		const setupInContext =
			/\b(?:no restrictions|unrestricted|without (?:rules|restrictions|limits)|fictional assistant|sem (?:restri|regras|limites)|assistente fict[íi]cio)\b/i.test(
				context
			);
		const payloadNow =
			/\b(?:now|then|so|agora|ent[ãa]o)\b[^.!?]{0,30}\b(?:reveal|show|tell|print|revele|mostre|diga|imprima)\b|\b(?:reveal|show|print)\b[^.!?]{0,25}\b(?:instruction|prompt|rule)/i.test(
				raw
			);

		if (setupInContext && payloadNow) {
			categories.add('jailbreak');
			categories.add('system-prompt-probe');
			evidence.push('ataque distribuído em várias mensagens');
		}
	}

	// --- ameaça e incitação -------------------------------------------------
	if (DIRECT_THREAT.test(raw)) {
		categories.add('threat');
		evidence.push('ameaça direta');
	}
	if (VIOLENCE_INCITEMENT.test(raw)) {
		categories.add('violence-incitement');
		evidence.push('incitação à violência');
	}

	// --- ódio e assédio: decisão combinada ---------------------------------
	//
	// Exige o conjunto: pedir produção de conteúdo + marcador hostil. O alvo
	// protegido agrava, mas assédio direcionado a uma pessoa também conta.
	// Enquadramento educacional derruba a suspeita — é o que impede bloquear
	// "como prevenir discurso de ódio".
	const asksProduction = PRODUCTION_VERBS.test(raw);
	const isHostile = HOSTILE_MARKERS.test(raw);
	const hasProtectedTarget = PROTECTED_TARGETS.test(raw);
	const isEducational = EDUCATIONAL_FRAMING.test(raw);

	if (asksProduction && isHostile && !isEducational) {
		categories.add(hasProtectedTarget ? 'hate' : 'harassment');
		if (hasProtectedTarget) categories.add('dehumanization');
		evidence.push('pedido de produção de conteúdo hostil');
	} else if (isHostile && hasProtectedTarget && !isEducational) {
		// Hostilidade contra grupo sem verbo de produção explícito: não é
		// conclusivo, mas merece a segunda camada.
		categories.add('hate');
		evidence.push('hostilidade contra grupo protegido, sem enquadramento educacional');
	}

	// --- veredito -----------------------------------------------------------
	const list = [...categories];

	if (list.length === 0) {
		return { risk: 'safe', confidence: 0.9, categories: [] };
	}

	const hasUnsafeContent = list.some((category) =>
		(['hate', 'harassment', 'threat', 'violence-incitement', 'dehumanization'] as SafetyCategory[]).includes(
			category
		)
	);
	const hasJailbreak = list.includes('jailbreak');
	const hasInjection = list.includes('prompt-injection') || list.includes('system-prompt-probe');
	const hasExfiltration = list.includes('data-exfiltration');

	// Ameaça e incitação são inequívocas; ódio inferido por combinação é menos.
	const strongUnsafe = list.includes('threat') || list.includes('violence-incitement');

	let risk: SafetyClassification['risk'];
	let confidence: number;

	if (hasUnsafeContent) {
		risk = 'unsafe_content';
		confidence = strongUnsafe ? 0.9 : asksProduction && isHostile ? 0.85 : 0.6;
	} else if (hasJailbreak) {
		risk = 'jailbreak';
		confidence = 0.85;
	} else if (hasInjection || hasExfiltration) {
		risk = 'prompt_injection';
		confidence = 0.85;
	} else {
		risk = 'suspicious';
		confidence = 0.5;
	}

	// Confiança baixa não vira bloqueio duro: fica `suspicious` para a camada
	// seguinte decidir, em vez de recusar uma pergunta legítima.
	if (confidence < 0.7 && risk !== 'suspicious') {
		risk = 'suspicious';
	}

	return { risk, confidence, categories: list, evidence };
}

/** Uma classificação permite seguir para o modelo? */
export function isAllowed(classification: SafetyClassification): boolean {
	if (classification.risk === 'safe') return true;
	// `suspicious` passa, mas o serviço reforça o isolamento e registra o
	// evento: recusar tudo que é ambíguo transformaria o chatbot em obstáculo.
	return classification.risk === 'suspicious';
}

/**
 * Texto de recusa (§19, §25).
 *
 * Curto, não moralizante, e nunca repete o conteúdo ofensivo de volta. Quando
 * dá, oferece o caminho útil — o objetivo é redirecionar para a documentação,
 * não dar sermão.
 */
export function refusalFor(classification: SafetyClassification): string {
	const { categories } = classification;

	if (categories.includes('system-prompt-probe')) {
		return 'Não consigo fornecer nem alterar minhas instruções internas. Posso explicar como usar a documentação — o que você está tentando descobrir?';
	}
	if (categories.includes('data-exfiltration') || categories.includes('secret-exposure')) {
		return 'Não tenho acesso a chaves, tokens ou credenciais, e não poderia repassá-los. Se precisa saber **como** autenticar, isso está na documentação e eu explico.';
	}
	if (categories.includes('prompt-injection') || categories.includes('jailbreak')) {
		return 'Sigo as minhas instruções e não posso substituí-las por outras. Posso responder perguntas sobre a documentação deste portal.';
	}
	if (categories.includes('threat') || categories.includes('violence-incitement')) {
		return 'Não posso ajudar com ameaças ou incitação à violência.';
	}
	if (categories.includes('hate') || categories.includes('dehumanization')) {
		return 'Não posso ajudar a criar conteúdo de ódio ou que ataque um grupo de pessoas. Se o interesse for entender o tema, posso dar uma explicação neutra.';
	}
	if (categories.includes('harassment')) {
		return 'Não posso ajudar a produzir conteúdo para atacar ou assediar alguém. Se quiser, explico o tema de forma neutra.';
	}

	return 'Não consigo ajudar com esse pedido. Posso responder perguntas sobre a documentação deste portal.';
}
