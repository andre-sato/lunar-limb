/**
 * Dicionários por idioma.
 *
 * O portal é nativamente pt-BR, com traduções em en e es. Um linter que só
 * conhecesse regras em inglês não apontaria nada de útil no conteúdo real —
 * por isso cada lista existe nos três idiomas, e as regras declaram a quais
 * idiomas se aplicam.
 */

import type { LintLanguage } from '../types';

type Dictionary<T> = Record<LintLanguage, T>;

/** §9 — termos vagos, sem significado verificável. */
export const WEASEL_WORDS: Dictionary<string[]> = {
	'pt-BR': [
		'geralmente',
		'normalmente',
		'frequentemente',
		'alguns',
		'algumas',
		'vários',
		'várias',
		'diversos',
		'diversas',
		'muitos',
		'muitas',
		'rápido',
		'rapidamente',
		'fácil',
		'simples',
		'etc',
	],
	en: [
		'usually',
		'generally',
		'often',
		'some',
		'many',
		'various',
		'several',
		'easy',
		'simple',
		'quick',
		'fast',
		'etc',
	],
	es: ['generalmente', 'normalmente', 'a menudo', 'algunos', 'algunas', 'varios', 'varias', 'fácil', 'rápido', 'etc'],
};

/** §10 — linguagem promocional. */
export const MARKETING_WORDS: Dictionary<string[]> = {
	'pt-BR': [
		'poderoso',
		'poderosa',
		'incrível',
		'revolucionário',
		'revolucionária',
		'inovador',
		'inovadora',
		'líder de mercado',
		'de ponta',
		'best-in-class',
		'imperdível',
		'excepcional',
		'perfeito',
		'perfeita',
	],
	en: [
		'powerful',
		'amazing',
		'best-in-class',
		'revolutionary',
		'seamless',
		'incredible',
		'world-class',
		'cutting-edge',
		'blazing',
		'effortless',
		'game-changing',
	],
	es: ['potente', 'increíble', 'revolucionario', 'revolucionaria', 'de vanguardia', 'excepcional', 'perfecto'],
};

/** §32 — afirmações absolutas que merecem revisão humana. */
export const ABSOLUTE_WORDS: Dictionary<string[]> = {
	'pt-BR': ['sempre', 'nunca', 'garantido', 'garantida', 'todos os casos', '100%', 'jamais', 'impossível'],
	en: ['always', 'never', 'guaranteed', 'every time', '100%', 'impossible', 'all cases'],
	es: ['siempre', 'nunca', 'garantizado', 'garantizada', '100%', 'imposible'],
};

/** §7 — construções prolixas, com a forma enxuta correspondente. */
export const WORDY_PHRASES: Dictionary<Array<{ pattern: string; replacement: string }>> = {
	'pt-BR': [
		{ pattern: 'a fim de que', replacement: 'para que' },
		{ pattern: 'a fim de', replacement: 'para' },
		{ pattern: 'com o objetivo de', replacement: 'para' },
		{ pattern: 'com a finalidade de', replacement: 'para' },
		{ pattern: 'no sentido de', replacement: 'para' },
		{ pattern: 'devido ao fato de que', replacement: 'porque' },
		{ pattern: 'pelo fato de que', replacement: 'porque' },
		{ pattern: 'em virtude de', replacement: 'por' },
		{ pattern: 'neste momento', replacement: 'agora' },
		{ pattern: 'no presente momento', replacement: 'agora' },
		{ pattern: 'faz-se necessário', replacement: 'é preciso' },
		{ pattern: 'é possível que você', replacement: 'você pode' },
		{ pattern: 'a maior parte de', replacement: 'a maioria de' },
		{ pattern: 'um grande número de', replacement: 'muitos' },
		{ pattern: 'de forma a', replacement: 'para' },
		{ pattern: 'caso seja necessário', replacement: 'se precisar' },
	],
	en: [
		{ pattern: 'in order to', replacement: 'to' },
		{ pattern: 'at this point in time', replacement: 'now' },
		{ pattern: 'at the present time', replacement: 'now' },
		{ pattern: 'due to the fact that', replacement: 'because' },
		{ pattern: 'in the event that', replacement: 'if' },
		{ pattern: 'for the purpose of', replacement: 'to' },
		{ pattern: 'in spite of the fact that', replacement: 'although' },
		{ pattern: 'a large number of', replacement: 'many' },
		{ pattern: 'the majority of', replacement: 'most' },
		{ pattern: 'is able to', replacement: 'can' },
		{ pattern: 'are able to', replacement: 'can' },
		{ pattern: 'has the ability to', replacement: 'can' },
		{ pattern: 'it is necessary to', replacement: 'you must' },
		{ pattern: 'in the case of', replacement: 'for' },
		{ pattern: 'prior to', replacement: 'before' },
		{ pattern: 'subsequent to', replacement: 'after' },
		{ pattern: 'with regard to', replacement: 'about' },
	],
	es: [
		{ pattern: 'con el fin de', replacement: 'para' },
		{ pattern: 'con el objetivo de', replacement: 'para' },
		{ pattern: 'debido al hecho de que', replacement: 'porque' },
		{ pattern: 'en este momento', replacement: 'ahora' },
		{ pattern: 'la mayor parte de', replacement: 'la mayoría de' },
		{ pattern: 'es capaz de', replacement: 'puede' },
	],
};

/** §34 — referências ambíguas em início de frase. */
export const AMBIGUOUS_STARTERS: Dictionary<string[]> = {
	'pt-BR': ['isso', 'isto', 'aquilo', 'ele', 'ela', 'eles', 'elas', 'o mesmo', 'a mesma', 'como visto acima'],
	en: ['it', 'this', 'that', 'they', 'these', 'those', 'the above', 'as mentioned earlier', 'as described before'],
	es: ['esto', 'eso', 'aquello', 'ellos', 'ellas', 'lo mismo', 'como se mencionó antes'],
};

/** §13 — títulos genéricos, que não descrevem o conteúdo. */
export const GENERIC_HEADINGS: Dictionary<string[]> = {
	'pt-BR': ['introdução', 'informações', 'detalhes', 'outros', 'diversos', 'geral', 'sobre', 'notas', 'observações'],
	en: ['introduction', 'information', 'details', 'other', 'miscellaneous', 'general', 'about', 'notes', 'overview'],
	es: ['introducción', 'información', 'detalles', 'otros', 'varios', 'general', 'notas'],
};

/** §12 — construções indiretas onde o imperativo seria mais claro. */
export const INDIRECT_INSTRUCTIONS: Dictionary<Array<{ pattern: string; hint: string }>> = {
	'pt-BR': [
		{ pattern: 'você (?:vai|irá) precisar (?:de |)', hint: 'use o imperativo: "Configure…"' },
		{ pattern: 'você (?:deve|deveria|precisa) (?:de |)', hint: 'use o imperativo: "Configure…"' },
		{ pattern: 'é necessário que você', hint: 'use o imperativo' },
		{ pattern: 'o usuário deve', hint: 'fale com o leitor no imperativo' },
	],
	en: [
		{ pattern: 'you will need to', hint: 'use the imperative: "Configure…"' },
		{ pattern: 'you should', hint: 'use the imperative: "Configure…"' },
		{ pattern: 'you need to', hint: 'use the imperative' },
		{ pattern: 'you must then', hint: 'use the imperative' },
		{ pattern: 'the user should', hint: 'address the reader directly' },
	],
	es: [
		{ pattern: 'necesitarás', hint: 'usa el imperativo' },
		{ pattern: 'debes', hint: 'usa el imperativo' },
		{ pattern: 'el usuario debe', hint: 'dirígete al lector' },
	],
};

/** §30/§31 — marcas de conteúdo inacabado. */
export const INCOMPLETE_MARKERS = [
	'TODO',
	'FIXME',
	'TBD',
	'WIP',
	'XXX',
	'HACK',
	'Lorem ipsum',
	'lorem ipsum',
	'coming soon',
	'em breve',
	'a definir',
	'próximamente',
];

/** §31 — placeholders que provavelmente ficaram esquecidos. */
export const SUSPICIOUS_PLACEHOLDERS = ['foo', 'bar', 'baz', 'asdf', 'qwerty', 'teste123', 'xxxx'];

/** §24 — texto de link sem valor descritivo. */
export const VAGUE_LINK_TEXT: Dictionary<string[]> = {
	'pt-BR': ['clique aqui', 'aqui', 'este link', 'link', 'leia mais', 'saiba mais', 'veja aqui', 'mais'],
	en: ['click here', 'here', 'this link', 'link', 'read more', 'learn more', 'see here', 'more'],
	es: ['haz clic aquí', 'aquí', 'este enlace', 'enlace', 'leer más', 'más'],
};

/** §25 — alt genérico, que não descreve a imagem. */
export const GENERIC_ALT_TEXT: Dictionary<string[]> = {
	'pt-BR': ['imagem', 'figura', 'foto', 'captura', 'screenshot', 'print', 'diagrama', 'exemplo'],
	en: ['image', 'picture', 'photo', 'screenshot', 'figure', 'diagram', 'example', 'graphic'],
	es: ['imagen', 'figura', 'foto', 'captura', 'diagrama', 'ejemplo'],
};

/**
 * §8 — voz passiva.
 *
 * Em português, particípio precedido de forma de "ser"/"estar". Em inglês,
 * forma de "to be" seguida de particípio. Ambos os padrões geram falso
 * positivo com alguma frequência, e é por isso que a regra nasce como
 * `suggestion`, nunca como erro.
 */
export const PASSIVE_VOICE: Dictionary<RegExp | null> = {
	'pt-BR':
		/(?<![\p{L}])(?:é|são|foi|foram|será|serão|seja|sejam|está|estão|estava|estavam)\s+(?:\p{L}+mente\s+)?\p{L}+(?:ado|ada|ados|adas|ido|ida|idos|idas)(?![\p{L}])/giu,
	en: /(?<![\p{L}])(?:is|are|was|were|be|been|being)\s+(?:\p{L}+ly\s+)?\p{L}+(?:ed|en)(?:\s+by)?(?![\p{L}])/giu,
	es: /(?<![\p{L}])(?:es|son|fue|fueron|será|serán|está|están)\s+(?:\p{L}+mente\s+)?\p{L}+(?:ado|ada|ados|adas|ido|ida|idos|idas)(?![\p{L}])/giu,
};

/** §17 — verbos de ação típicos no início de um passo de procedimento. */
export const IMPERATIVE_HINTS: Dictionary<RegExp> = {
	'pt-BR': /^(?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ]\p{L}*(?:e|a|i|ue)\b)/u,
	en: /^(?:[A-Z]\p{L}*)/u,
	es: /^(?:[A-ZÁÉÍÓÚÑ]\p{L}*)/u,
};

/** §14 — seções esperadas por tipo de página. */
export const EXPECTED_SECTIONS: Record<string, Dictionary<string[]>> = {
	tutorial: {
		'pt-BR': ['pré-requisitos', 'passos', 'próximos passos'],
		en: ['prerequisites', 'steps', 'next steps'],
		es: ['requisitos previos', 'pasos', 'próximos pasos'],
	},
	'how-to': {
		'pt-BR': ['pré-requisitos', 'passos'],
		en: ['prerequisites', 'steps'],
		es: ['requisitos previos', 'pasos'],
	},
	reference: {
		'pt-BR': ['parâmetros', 'exemplos'],
		en: ['parameters', 'examples'],
		es: ['parámetros', 'ejemplos'],
	},
	'api-reference': {
		'pt-BR': ['parâmetros', 'resposta', 'erros'],
		en: ['parameters', 'response', 'errors'],
		es: ['parámetros', 'respuesta', 'errores'],
	},
	concept: {
		'pt-BR': ['como funciona'],
		en: ['how it works'],
		es: ['cómo funciona'],
	},
	troubleshooting: {
		'pt-BR': ['sintoma', 'solução'],
		en: ['symptom', 'solution'],
		es: ['síntoma', 'solución'],
	},
	overview: {
		'pt-BR': [],
		en: [],
		es: [],
	},
};
