/**
 * Regras sobre o texto corrido: gramática, clareza, concisão, technical
 * writing, terminologia e consistência.
 *
 * Todas operam sobre `document.prose`, que já exclui código. Nenhuma delas
 * decide severidade — isso vem da configuração.
 */

import type { LintRule } from '../types';
import { scanProse, scanLines, termsPattern, escapeRegex, excerpt, words } from './helpers';
import {
	WEASEL_WORDS,
	MARKETING_WORDS,
	ABSOLUTE_WORDS,
	WORDY_PHRASES,
	AMBIGUOUS_STARTERS,
	INDIRECT_INSTRUCTIONS,
	PASSIVE_VOICE,
} from './language';

// ---------------------------------------------------------------- gramática

const duplicatedWords: LintRule = {
	id: 'GRAMMAR-001',
	category: 'grammar',
	severity: 'warning',
	weight: 1.5,
	description: 'Palavra repetida em sequência.',
	run: ({ document, report }) => {
		// A repetição precisa ser da mesma palavra, colada por espaço simples.
		// Palavras curtas legítimas em sequência ("que que" em fala) são raras
		// em documentação, mas o mínimo de 2 letras evita casos como "a a".
		for (const match of scanProse(document, /(?<![\p{L}\p{N}])(\p{L}{3,})\s+\1(?![\p{L}\p{N}])/giu)) {
			report({
				ruleId: 'GRAMMAR-001',
				message: `Palavra repetida: "${match.match[1]}".`,
				location: match.location,
				suggestion: match.match[1],
				fix: { type: 'text-replacement', replacement: match.match[1] },
			});
		}
	},
};

const doubleSpaces: LintRule = {
	id: 'GRAMMAR-002',
	category: 'grammar',
	severity: 'suggestion',
	weight: 0.3,
	description: 'Espaços duplicados entre palavras.',
	run: ({ document, report }) => {
		for (const match of scanLines(document, /(?<=\S) {2,}(?=\S)/g)) {
			report({
				ruleId: 'GRAMMAR-002',
				message: 'Espaços duplicados.',
				location: match.location,
				fix: { type: 'text-replacement', replacement: ' ' },
			});
		}
	},
};

const spaceBeforePunctuation: LintRule = {
	id: 'GRAMMAR-003',
	category: 'grammar',
	severity: 'suggestion',
	weight: 0.5,
	description: 'Espaço antes de pontuação.',
	run: ({ document, report }) => {
		for (const match of scanLines(document, /(?<=\S)\s+([,;:!?])(?=\s|$)/g)) {
			report({
				ruleId: 'GRAMMAR-003',
				message: `Espaço antes de "${match.match[1]}".`,
				location: match.location,
				fix: { type: 'text-replacement', replacement: match.match[1] },
			});
		}
	},
};

const lowercaseAfterPeriod: LintRule = {
	id: 'GRAMMAR-004',
	category: 'grammar',
	severity: 'warning',
	weight: 1,
	description: 'Frase iniciada em minúscula.',
	run: ({ document, report }) => {
		for (const paragraph of document.paragraphs) {
			paragraph.sentences.forEach((sentence, index) => {
				const first = sentence.text.trimStart()[0];
				if (!first) return;
				if (!/\p{Ll}/u.test(first)) return;
				if (first.toUpperCase() === first) return;

				// Confere o caractere **no arquivo**, não no buffer reconstruído.
				//
				// Na primeira frase, o ponto de referência é o início do
				// parágrafo: um parágrafo que abre com código inline, link ou
				// ênfase (`` `npm install` ``, `[texto]`, `**palavra**`) começa
				// com minúscula no buffer sem estar errado. Como a divisão em
				// frases descarta o espaço inicial, olhar a posição da frase
				// apontaria para a primeira palavra e perderia essa informação.
				const reference = index === 0 ? paragraph.location : sentence.location;
				const rawLine = document.lines[reference.startLine - 1] ?? '';
				const rawChar = rawLine[reference.startColumn - 1];
				if (rawChar && !/\p{Ll}/u.test(rawChar)) return;

				report({
					ruleId: 'GRAMMAR-004',
					message: 'A frase começa em minúscula.',
					location: sentence.location,
					explanation: excerpt(sentence.text),
				});
			});
		}
	},
};

// ------------------------------------------------------------------ clareza

const longSentence: LintRule = {
	id: 'CLARITY-001',
	category: 'clarity',
	severity: 'suggestion',
	weight: 0.8,
	description: 'Frase longa demais.',
	run: ({ document, config, report }) => {
		const limit = config.thresholds.maxSentenceWords;
		for (const paragraph of document.paragraphs) {
			for (const sentence of paragraph.sentences) {
				if (sentence.words <= limit) continue;
				report({
					ruleId: 'CLARITY-001',
					message: `Frase com ${sentence.words} palavras (limite: ${limit}).`,
					location: sentence.location,
					suggestion: 'Divida em frases menores ou use uma lista.',
					explanation: excerpt(sentence.text, 90),
					// Frase muito acima do limite pesa mais do que uma no limiar.
					weight: sentence.words > limit * 1.8 ? 1.6 : 0.8,
				});
			}
		}
	},
};

const ambiguousReference: LintRule = {
	id: 'CLARITY-002',
	category: 'clarity',
	severity: 'warning',
	weight: 1,
	description: 'Referência ambígua no início da frase.',
	run: ({ document, language, report }) => {
		const starters = AMBIGUOUS_STARTERS[language];
		const pattern = termsPattern(starters, 'giu');
		if (!pattern) return;

		for (const paragraph of document.paragraphs) {
			paragraph.sentences.forEach((sentence, index) => {
				// Só a primeira frase de um parágrafo é problemática: dentro do
				// parágrafo o referente costuma estar na frase anterior, e apontar
				// todo "isso" transformaria a regra em ruído.
				if (index > 0) return;
				const head = sentence.text.trimStart();
				const firstWord = head.split(/\s+/)[0]?.replace(/[^\p{L}]/gu, '') ?? '';
				if (!firstWord) return;

				const matches = new RegExp(`^(?:${starters.map(escapeRegex).join('|')})$`, 'iu').test(firstWord);
				if (!matches) return;

				report({
					ruleId: 'CLARITY-002',
					message: `Referência ambígua: "${firstWord}".`,
					location: sentence.location,
					suggestion: 'Diga explicitamente a que o termo se refere.',
				});
			});
		}
	},
};

const passiveVoice: LintRule = {
	id: 'CLARITY-003',
	category: 'clarity',
	severity: 'suggestion',
	weight: 0.4,
	description: 'Voz passiva onde a ativa seria mais direta.',
	run: ({ document, language, report }) => {
		const pattern = PASSIVE_VOICE[language];
		if (!pattern) return;

		for (const match of scanProse(document, pattern)) {
			report({
				ruleId: 'CLARITY-003',
				message: 'Voz passiva.',
				location: match.location,
				explanation: excerpt(match.text),
				// A §8 é explícita: não transformar toda voz passiva em erro.
				suggestion: 'Prefira a voz ativa quando houver sujeito claro.',
			});
		}
	},
};

// ------------------------------------------------------------------ concisão

const wordyPhrase: LintRule = {
	id: 'CONCISENESS-001',
	category: 'conciseness',
	severity: 'suggestion',
	weight: 0.4,
	description: 'Construção prolixa com equivalente mais curto.',
	run: ({ document, language, report }) => {
		for (const entry of WORDY_PHRASES[language]) {
			const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(entry.pattern)}(?![\\p{L}\\p{N}])`, 'giu');
			for (const match of scanProse(document, pattern)) {
				report({
					ruleId: 'CONCISENESS-001',
					message: `"${match.text}" pode ser "${entry.replacement}".`,
					location: match.location,
					suggestion: entry.replacement,
					fix: { type: 'text-replacement', replacement: entry.replacement },
				});
			}
		}
	},
};

// -------------------------------------------------------- technical writing

const forbiddenTerm: LintRule = {
	id: 'STYLE-001',
	category: 'technicalWriting',
	severity: 'suggestion',
	weight: 0.5,
	description: 'Termo proibido pelo style guide.',
	run: ({ document, config, language, report }) => {
		const pattern = termsPattern(config.forbiddenTerms[language] ?? []);
		if (!pattern) return;

		for (const match of scanProse(document, pattern)) {
			report({
				ruleId: 'STYLE-001',
				message: `Evite "${match.text}".`,
				location: match.location,
				suggestion: 'Remova a palavra ou substitua por uma informação concreta.',
				// Remoção é segura: estes termos não mudam o sentido da frase.
				fix: { type: 'text-replacement', replacement: '' },
			});
		}
	},
};

const weaselWord: LintRule = {
	id: 'TECH-001',
	category: 'technicalWriting',
	severity: 'suggestion',
	weight: 0.4,
	description: 'Termo vago, sem informação verificável.',
	run: ({ document, language, report }) => {
		const pattern = termsPattern(WEASEL_WORDS[language]);
		if (!pattern) return;

		for (const match of scanProse(document, pattern)) {
			report({
				ruleId: 'TECH-001',
				message: `Termo vago: "${match.text}".`,
				location: match.location,
				suggestion: 'Troque por um dado concreto (quantidade, prazo, número de passos).',
			});
		}
	},
};

const marketingLanguage: LintRule = {
	id: 'TECH-MKT-001',
	category: 'technicalWriting',
	severity: 'warning',
	weight: 1,
	description: 'Linguagem promocional em documentação técnica.',
	run: ({ document, language, report }) => {
		const pattern = termsPattern(MARKETING_WORDS[language]);
		if (!pattern) return;

		for (const match of scanProse(document, pattern)) {
			report({
				ruleId: 'TECH-MKT-001',
				message: `Linguagem promocional: "${match.text}".`,
				location: match.location,
				suggestion: 'Descreva o que a funcionalidade faz, em vez de qualificá-la.',
			});
		}
	},
};

const absoluteStatement: LintRule = {
	id: 'TECH-ACCURACY-001',
	category: 'technicalWriting',
	severity: 'warning',
	weight: 0.8,
	description: 'Afirmação absoluta que merece verificação.',
	run: ({ document, language, report }) => {
		const pattern = termsPattern(ABSOLUTE_WORDS[language]);
		if (!pattern) return;

		for (const match of scanProse(document, pattern)) {
			report({
				ruleId: 'TECH-ACCURACY-001',
				message: `Afirmação absoluta: "${match.text}".`,
				location: match.location,
				// A §2 e a §32 são explícitas: o linter não afirma que a
				// informação está errada, apenas sinaliza para revisão humana.
				explanation: 'O linter não verifica veracidade técnica; confirme se a afirmação se sustenta.',
				suggestion: 'Se houver exceções, descreva-as.',
			});
		}
	},
};

const indirectInstruction: LintRule = {
	id: 'TECH-ACT-001',
	category: 'technicalWriting',
	severity: 'suggestion',
	weight: 0.5,
	description: 'Instrução indireta onde o imperativo seria mais claro.',
	run: ({ document, language, report }) => {
		for (const entry of INDIRECT_INSTRUCTIONS[language]) {
			const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${entry.pattern}`, 'giu');
			for (const match of scanProse(document, pattern)) {
				report({
					ruleId: 'TECH-ACT-001',
					message: `Instrução indireta: "${excerpt(match.text, 40)}".`,
					location: match.location,
					suggestion: entry.hint,
				});
			}
		}
	},
};

// -------------------------------------------------------------- terminologia

const preferredTerm: LintRule = {
	id: 'TERM-002',
	category: 'terminology',
	severity: 'warning',
	weight: 1,
	description: 'Variante em lugar do termo preferido do glossário.',
	run: ({ document, config, report }) => {
		for (const entry of config.terminology) {
			for (const alternative of entry.alternatives) {
				if (alternative === entry.term) continue;
				// Sensível a maiúsculas: a diferença entre "API key" e "API Key"
				// é justamente o que a regra existe para pegar.
				const pattern = new RegExp(
					`(?<![\\p{L}\\p{N}])${escapeRegex(alternative)}(?![\\p{L}\\p{N}])`,
					'gu'
				);
				for (const match of scanProse(document, pattern)) {
					report({
						ruleId: 'TERM-002',
						message: `Use "${entry.term}" em vez de "${alternative}".`,
						location: match.location,
						suggestion: entry.term,
						fix: { type: 'text-replacement', replacement: entry.term },
					});
				}
			}
		}
	},
};

const undefinedAcronym: LintRule = {
	id: 'TERM-001',
	category: 'terminology',
	severity: 'warning',
	weight: 0.8,
	description: 'Acrônimo usado sem definição.',
	run: ({ document, config, report }) => {
		const known = new Set(Object.keys(config.acronyms).map((key) => key.toUpperCase()));
		const seen = new Set<string>();

		// Considera definido o acrônimo que aparece entre parênteses depois da
		// forma extensa — "Single Sign-On (SSO)" — em qualquer ponto da página.
		const definedInPage = new Set<string>();
		for (const match of scanProse(document, /\(([A-Z]{2,6})\)/g)) {
			definedInPage.add(match.match[1]);
		}

		// Marcas de conteúdo inacabado já são erro pela COMPLETENESS-001;
		// acusá-las também de acrônimo indefinido é ruído sobre um problema
		// que o autor já foi avisado para resolver.
		const notAcronyms = new Set(['TODO', 'FIXME', 'TBD', 'WIP', 'XXX', 'HACK', 'OK', 'NOTE']);

		for (const match of scanProse(document, /(?<![\p{L}\p{N}])[A-Z]{2,6}(?![\p{L}\p{N}])/gu)) {
			const acronym = match.text;
			if (notAcronyms.has(acronym)) continue;
			if (known.has(acronym) || definedInPage.has(acronym) || seen.has(acronym)) continue;
			seen.add(acronym);

			report({
				ruleId: 'TERM-001',
				message: `Acrônimo possivelmente não definido: "${acronym}".`,
				location: match.location,
				suggestion: `Escreva a forma extensa na primeira ocorrência: Forma Extensa (${acronym}).`,
				explanation: 'Cadastre-o em `acronyms` no style guide se já for conhecido do público.',
			});
		}
	},
};

// -------------------------------------------------------------- consistência

const inconsistentTerm: LintRule = {
	id: 'CONSISTENCY-001',
	category: 'consistency',
	severity: 'warning',
	weight: 1,
	description: 'Mesma expressão grafada de formas diferentes na página.',
	run: ({ document, report }) => {
		// Agrupa por forma normalizada e sinaliza quando a mesma expressão
		// aparece com grafias diferentes. Limita-se a expressões de duas
		// palavras porque, em uma palavra só, variação de caixa quase sempre é
		// início de frase.
		const groups = new Map<string, Map<string, { count: number; location: ReturnType<typeof firstLocation> }>>();

		function firstLocation(loc: { startLine: number; startColumn: number }) {
			return loc;
		}

		for (const match of scanProse(document, /(?<![\p{L}\p{N}])\p{L}[\p{L}\p{N}-]+\s\p{L}[\p{L}\p{N}-]+(?![\p{L}\p{N}])/gu)) {
			const surface = match.text;
			const key = surface.toLowerCase().replace(/[-\s]+/g, ' ');
			const variants = groups.get(key) ?? new Map();
			const existing = variants.get(surface);
			if (existing) existing.count++;
			else variants.set(surface, { count: 1, location: match.location });
			groups.set(key, variants);
		}

		for (const [, variants] of groups) {
			if (variants.size < 2) continue;

			const sorted = [...variants.entries()].sort((a, b) => b[1].count - a[1].count);
			const [preferred] = sorted[0];
			const others = sorted.slice(1);

			// Exige que a forma dominante apareça mais de uma vez: com uma
			// ocorrência de cada, não há grafia "preferida" — só duas escritas.
			if (sorted[0][1].count < 2) continue;

			for (const [variant, info] of others) {
				report({
					ruleId: 'CONSISTENCY-001',
					message: `Grafia inconsistente: "${variant}" e "${preferred}" na mesma página.`,
					location: info.location,
					suggestion: preferred,
				});
			}
		}
	},
};

const sentenceStartsWithCode: LintRule = {
	id: 'CLARITY-004',
	category: 'clarity',
	severity: 'info',
	weight: 0,
	description: 'Estatística de frases longas do documento.',
	run: ({ document, config, report }) => {
		const all = document.paragraphs.flatMap((paragraph) => paragraph.sentences);
		if (all.length < 5) return;

		const long = all.filter((sentence) => sentence.words > config.thresholds.maxSentenceWords);
		const ratio = long.length / all.length;
		if (ratio < config.thresholds.longSentenceRatio) return;

		report({
			ruleId: 'CLARITY-004',
			message: `${Math.round(ratio * 100)}% das frases passam de ${config.thresholds.maxSentenceWords} palavras.`,
			location: { startLine: document.frontmatterLines + 1, startColumn: 1 },
			suggestion: 'O texto inteiro tende ao período longo; considere revisar o ritmo.',
		});
	},
};

export const textRules: LintRule[] = [
	duplicatedWords,
	doubleSpaces,
	spaceBeforePunctuation,
	lowercaseAfterPeriod,
	longSentence,
	ambiguousReference,
	passiveVoice,
	wordyPhrase,
	forbiddenTerm,
	weaselWord,
	marketingLanguage,
	absoluteStatement,
	indirectInstruction,
	preferredTerm,
	undefinedAcronym,
	inconsistentTerm,
	sentenceStartsWithCode,
];

export const __testing = { words };
