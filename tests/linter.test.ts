import { describe, it, expect } from 'vitest';
import { lintDocument, summarizeWorkspace } from '../src/lib/linter/lint';
import { parseDocument, splitSentences, countWords, inferLanguage } from '../src/lib/linter/parse';
import { calculateScore, readabilityToScore, bandFor, evaluateGate, round1 } from '../src/lib/linter/score';
import { buildSuppressionIndex, isSuppressed, profileFromFrontmatter } from '../src/lib/linter/directives';
import { DEFAULT_CONFIG, mergeConfig, ruleSettings } from '../src/lib/linter/config';
import { ALL_RULES, duplicateRuleIds } from '../src/lib/linter/rules';
import { SCORED_CATEGORIES } from '../src/lib/linter/types';
import type { LintFinding, LintResult } from '../src/lib/linter/types';

const config = DEFAULT_CONFIG;

async function lint(body: string, path = 'guides/teste.md'): Promise<LintResult> {
	return lintDocument(body, { path, config });
}

function ids(result: LintResult): string[] {
	return result.findings.map((finding) => finding.ruleId);
}

function doc(body: string, frontmatter = 'title: Teste\ndescription: Uma descrição suficientemente longa.'): string {
	return `---\n${frontmatter}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------- parsing

describe('parser', () => {
	it('separa frontmatter e desloca as linhas do corpo', () => {
		const parsed = parseDocument(doc('Primeira frase aqui.'), { path: 'a.md' });
		expect(parsed.frontmatter.title).toBe('Teste');
		// O frontmatter ocupa 4 linhas; somada a linha em branco, o parágrafo
		// cai na 6 do arquivo — e não na 1 do corpo.
		expect(parsed.paragraphs[0].location.startLine).toBe(6);
	});

	it('divide frases sem quebrar em abreviações e decimais', () => {
		const parts = splitSentences('Use a versão 3.5 do SDK. Depois execute o comando, ex. npm install. Pronto.');
		expect(parts).toHaveLength(3);
		expect(parts[0].text).toContain('3.5');
	});

	it('não quebra frase em reticências', () => {
		expect(splitSentences('Aguarde... o processo termina sozinho.')).toHaveLength(1);
	});

	it('conta palavras ignorando marcação', () => {
		expect(countWords('**negrito** e `código` aqui')).toBe(4);
	});

	it('registra as linhas de bloco de código', () => {
		const parsed = parseDocument(doc('Texto.\n\n```bash\nnpm install\n```'), { path: 'a.md' });
		expect(parsed.codeBlocks).toHaveLength(1);
		expect(parsed.codeBlocks[0].lang).toBe('bash');
		expect(parsed.codeLines.size).toBeGreaterThan(0);
	});

	it('infere o idioma pelo caminho', () => {
		expect(inferLanguage('en/guides/a.md', {})).toBe('en');
		expect(inferLanguage('es/guides/a.md', {})).toBe('es');
		expect(inferLanguage('guides/a.md', {})).toBe('pt-BR');
		// O frontmatter tem precedência sobre o caminho.
		expect(inferLanguage('guides/a.md', { lang: 'en' })).toBe('en');
	});

	it('não derruba a análise com MDX malformado', () => {
		const parsed = parseDocument(doc('<Componente sem fechar'), { path: 'a.mdx' });
		expect(parsed.parseError).not.toBeNull();
		expect(parsed.paragraphs).toEqual([]);
	});
});

// ------------------------------------------------------- falsos positivos

describe('falsos positivos que o parser precisa evitar', () => {
	it('não inventa espaço duplo entre nós inline', async () => {
		// Concatenar nós inline com espaço produziria "negrito ." e faria as
		// regras de espaçamento acusarem texto perfeitamente escrito.
		const result = await lint(doc('Use o **negrito**. Depois o `código`, e siga.'));
		expect(ids(result)).not.toContain('GRAMMAR-002');
		expect(ids(result)).not.toContain('GRAMMAR-003');
	});

	it('não cobra terminologia dentro de código inline', async () => {
		const withTerminology = mergeConfig(
			DEFAULT_CONFIG,
			{ terminology: [{ term: 'API', alternatives: ['api'] }] },
			'teste'
		);
		const result = await lintDocument(doc('O bloco `api-essentials` reúne os avisos comuns.'), {
			path: 'a.md',
			config: withTerminology,
		});
		expect(ids(result)).not.toContain('TERM-002');
	});

	it('não acusa minúscula quando a frase começa com código ou ênfase', async () => {
		const result = await lint(doc('`npm install` instala as dependências do projeto.'));
		expect(ids(result)).not.toContain('GRAMMAR-004');
	});

	it('ignora import de MDX', async () => {
		const body = "import Algo from '@astrojs/starlight/components';\n\nTexto normal da página aqui.";
		const result = await lintDocument(doc(body), { path: 'guias/a.mdx', config });
		expect(ids(result)).not.toContain('GRAMMAR-004');
	});

	it('não considera vazia a seção que contém subseções', async () => {
		const result = await lint(doc('## Parte 1\n\n### Detalhe\n\nConteúdo real da subseção aqui.'));
		const empties = result.findings.filter((f) => f.ruleId === 'COMPLETENESS-002');
		expect(empties.map((f) => f.message).join(' ')).not.toContain('Parte 1');
	});

	it('não trata TODO como acrônimo indefinido', async () => {
		const result = await lint(doc('TODO: escrever esta seção.'));
		expect(ids(result)).toContain('COMPLETENESS-001');
		expect(ids(result)).not.toContain('TERM-001');
	});

	it('não cobra espaçamento dentro de tabela alinhada', async () => {
		const result = await lint(doc('| Nome    | Tipo |\n| ------- | ---- |\n| id      | UUID |'));
		expect(ids(result)).not.toContain('GRAMMAR-002');
	});
});

// ------------------------------------------------------------------ regras

describe('regras', () => {
	it('todos os ids são únicos', () => {
		expect(duplicateRuleIds()).toEqual([]);
	});

	it('toda regra declara categoria, severidade e peso', () => {
		for (const rule of ALL_RULES) {
			expect(rule.id).toMatch(/^[A-Z-]+-\d+$/);
			expect(SCORED_CATEGORIES.includes(rule.category as never) || rule.category === 'aiReadiness').toBe(true);
			expect(rule.weight).toBeGreaterThanOrEqual(0);
		}
	});

	it('detecta palavra repetida e oferece correção', async () => {
		const result = await lint(doc('O sistema envia uma uma notificação para o cliente.'));
		const finding = result.findings.find((f) => f.ruleId === 'GRAMMAR-001');
		expect(finding).toBeDefined();
		expect(finding!.fix).toEqual({ type: 'text-replacement', replacement: 'uma' });
	});

	it('detecta título que pula nível', async () => {
		const result = await lint(doc('## Autenticação\n\nTexto.\n\n#### Chaves\n\nMais texto.'));
		expect(ids(result)).toContain('STRUCTURE-001');
	});

	it('detecta título duplicado', async () => {
		const result = await lint(doc('## Erros\n\nUm.\n\n## Erros\n\nDois.'));
		expect(ids(result)).toContain('STRUCTURE-002');
	});

	it('detecta bloco de código sem linguagem', async () => {
		const result = await lint(doc('Texto.\n\n```\nnpm install pacote\n```'));
		expect(ids(result)).toContain('CODE-001');
	});

	it('detecta imagem sem texto alternativo', async () => {
		const result = await lint(doc('![](/imagem.png)'));
		expect(ids(result)).toContain('IMAGE-001');
	});

	it('detecta alt genérico e alt igual ao nome do arquivo', async () => {
		const generic = await lint(doc('![imagem](/a.png)'));
		expect(ids(generic)).toContain('IMAGE-002');

		const filename = await lint(doc('![diagrama.png](/a.png)'));
		expect(ids(filename)).toContain('IMAGE-002');
	});

	it('detecta link sem texto descritivo e sem destino', async () => {
		const result = await lint(doc('Veja [clique aqui](/docs) e [este link]().'));
		expect(ids(result)).toContain('LINK-001');
		expect(ids(result)).toContain('LINK-004');
	});

	it('detecta linguagem promocional', async () => {
		const result = await lint(doc('Nossa API poderosa entrega uma experiência incrível.'));
		expect(ids(result)).toContain('TECH-MKT-001');
	});

	it('detecta afirmação absoluta sem declará-la incorreta', async () => {
		const result = await lint(doc('Esta rota sempre devolve 200.'));
		const finding = result.findings.find((f) => f.ruleId === 'TECH-ACCURACY-001');
		expect(finding).toBeDefined();
		// A §2 proíbe afirmar que a informação está tecnicamente errada.
		expect(finding!.explanation).toContain('não verifica veracidade');
	});

	it('detecta construção prolixa e sugere a forma curta', async () => {
		const result = await lintDocument(doc('You must configure the key in order to authenticate.'), {
			path: 'en/a.md',
			config,
		});
		const finding = result.findings.find((f) => f.ruleId === 'CONCISENESS-001');
		expect(finding).toBeDefined();
		expect(finding!.suggestion).toBe('to');
	});

	it('detecta TODO como erro de completude', async () => {
		const result = await lint(doc('## Autenticação\n\nTODO: adicionar exemplo'));
		const finding = result.findings.find((f) => f.ruleId === 'COMPLETENESS-001');
		expect(finding?.severity).toBe('error');
	});

	it('detecta frase longa demais', async () => {
		const long = `Este é um período deliberadamente extenso ${'com muitas palavras encadeadas '.repeat(8)}e que segue sem pausa.`;
		const result = await lint(doc(long));
		expect(ids(result)).toContain('CLARITY-001');
	});

	it('detecta referência ambígua no início do parágrafo', async () => {
		const result = await lint(doc('Isso devolve um erro quando a chave expira.'));
		expect(ids(result)).toContain('CLARITY-002');
	});

	it('aplica regras por idioma', async () => {
		// "simply" é proibido em inglês; não deve ser cobrado no texto pt-BR.
		const en = await lintDocument(doc('Simply run the command to continue.'), { path: 'en/a.md', config });
		expect(ids(en)).toContain('STYLE-001');

		const pt = await lintDocument(doc('Simply é uma palavra em inglês nesta frase.'), {
			path: 'guides/a.md',
			config,
		});
		expect(ids(pt)).not.toContain('STYLE-001');
	});

	it('só aplica regra de tipo de página ao tipo declarado', async () => {
		const tutorial = await lint(doc('Texto sem exemplo nenhum.', 'title: T\ntype: tutorial'));
		expect(ids(tutorial)).toContain('ACTION-001');

		const concept = await lint(doc('Texto sem exemplo nenhum.', 'title: T\ntype: concept'));
		expect(ids(concept)).not.toContain('ACTION-001');
	});

	it('cobra seções esperadas do tipo de página', async () => {
		const result = await lint(doc('## Passos\n\nFaça algo.', 'title: T\ntype: tutorial'));
		const missing = result.findings.filter((f) => f.ruleId === 'STRUCTURE-006');
		expect(missing.length).toBeGreaterThan(0);
	});

	it('não derruba a análise quando uma regra lança', async () => {
		// Documento vazio exercita caminhos degenerados em todas as regras.
		const result = await lint('');
		expect(result).toBeDefined();
		expect(result.score).toBeGreaterThanOrEqual(0);
	});
});

// ------------------------------------------------------------- supressão

describe('supressão de regras', () => {
	it('silencia a próxima linha', async () => {
		const body = '<!-- lint-disable-next-line TECH-MKT-001 -->\nNossa API poderosa resolve tudo.';
		const result = await lint(doc(body));
		expect(ids(result)).not.toContain('TECH-MKT-001');
		expect(result.suppressed.some((s) => s.ruleId === 'TECH-MKT-001')).toBe(true);
	});

	it('silencia um bloco entre disable e enable', () => {
		const raw = [
			'<!-- lint-disable STYLE-001 -->',
			'linha um',
			'linha dois',
			'<!-- lint-enable STYLE-001 -->',
			'linha fora',
		].join('\n');
		const index = buildSuppressionIndex(raw, {});
		expect(isSuppressed(index, 'STYLE-001', 2)).not.toBeNull();
		expect(isSuppressed(index, 'STYLE-001', 5)).toBeNull();
		// Outra regra não é afetada.
		expect(isSuppressed(index, 'CLARITY-001', 2)).toBeNull();
	});

	it('bloco sem enable vale até o fim do arquivo', () => {
		const index = buildSuppressionIndex('<!-- lint-disable STYLE-001 -->\na\nb\nc', {});
		expect(isSuppressed(index, 'STYLE-001', 4)).not.toBeNull();
	});

	it('diretiva sem id silencia todas as regras', () => {
		const index = buildSuppressionIndex('<!-- lint-disable-next-line -->\ntexto', {});
		expect(isSuppressed(index, 'QUALQUER-001', 2)).not.toBeNull();
	});

	it('frontmatter ignora a regra na página inteira', async () => {
		const result = await lint(
			doc('Nossa API poderosa resolve tudo.', 'title: T\nlint:\n  ignore:\n    - TECH-MKT-001')
		);
		expect(ids(result)).not.toContain('TECH-MKT-001');
		expect(result.suppressed[0].reason).toBe('frontmatter');
	});

	it('lê o profile do frontmatter', () => {
		expect(profileFromFrontmatter({ lint: { profile: 'api-docs' } })).toBe('api-docs');
		expect(profileFromFrontmatter({})).toBeNull();
	});
});

// ------------------------------------------------------------ configuração

describe('configuração', () => {
	it('permite desabilitar e reconfigurar uma regra', () => {
		const custom = mergeConfig(
			DEFAULT_CONFIG,
			{ rules: { 'STYLE-001': { enabled: false }, 'CLARITY-001': { severity: 'error', weight: 5 } } },
			'custom'
		);

		expect(ruleSettings(custom, 'STYLE-001', 'suggestion', 1).enabled).toBe(false);
		const clarity = ruleSettings(custom, 'CLARITY-001', 'suggestion', 1);
		expect(clarity.severity).toBe('error');
		expect(clarity.weight).toBe(5);
	});

	it('uma regra desabilitada não gera finding', async () => {
		const custom = mergeConfig(DEFAULT_CONFIG, { rules: { 'TECH-MKT-001': { enabled: false } } }, 'custom');
		const result = await lintDocument(doc('Nossa API poderosa resolve tudo.'), { path: 'a.md', config: custom });
		expect(ids(result)).not.toContain('TECH-MKT-001');
	});

	it('aceita lista de termos proibidos única ou por idioma', () => {
		const flat = mergeConfig(DEFAULT_CONFIG, { forbiddenTerms: ['xyz'] }, 'c');
		expect(flat.forbiddenTerms['pt-BR']).toContain('xyz');
		expect(flat.forbiddenTerms.en).toContain('xyz');

		const byLanguage = mergeConfig(DEFAULT_CONFIG, { forbiddenTerms: { en: ['abc'] } }, 'c');
		expect(byLanguage.forbiddenTerms.en).toContain('abc');
		expect(byLanguage.forbiddenTerms['pt-BR']).toEqual([]);
	});

	it('limiares configuráveis mudam o resultado', async () => {
		const strict = mergeConfig(DEFAULT_CONFIG, { thresholds: { maxSentenceWords: 5 } }, 'strict');
		const result = await lintDocument(doc('Esta frase tem bem mais de cinco palavras ao todo.'), {
			path: 'a.md',
			config: strict,
		});
		expect(ids(result)).toContain('CLARITY-001');
	});
});

// ---------------------------------------------------------------- score

function finding(over: Partial<LintFinding> = {}): LintFinding {
	return {
		id: 'x',
		ruleId: 'TESTE-001',
		category: 'grammar',
		severity: 'warning',
		message: 'teste',
		location: { startLine: 1, startColumn: 1 },
		weight: 1,
		...over,
	};
}

describe('motor de score', () => {
	it('documento sem problemas tira 10', () => {
		const score = calculateScore({ findings: [], config, words: 300, readingEase: 70 });
		expect(score.score).toBe(10);
		expect(score.band).toBe('Excelente');
	});

	it('nunca sai da faixa 0–10', () => {
		const many = Array.from({ length: 200 }, () =>
			finding({ severity: 'error', weight: 5, category: 'structure' })
		);
		const score = calculateScore({ findings: many, config, words: 50, readingEase: 10 });
		expect(score.score).toBeGreaterThanOrEqual(0);
		expect(score.score).toBeLessThanOrEqual(10);
	});

	it('não é simplesmente 10 menos o número de erros (§83)', () => {
		// Uma página com um erro de gramática deve ficar bem melhor do que uma
		// sem erro de gramática mas com estrutura e acionabilidade ruins.
		const gramatical = calculateScore({
			findings: [finding({ severity: 'error', category: 'grammar', weight: 1.5 })],
			config,
			words: 400,
			readingEase: 60,
		});

		const estrutural = calculateScore({
			findings: [
				finding({ severity: 'error', category: 'structure', weight: 2.5 }),
				finding({ severity: 'warning', category: 'structure', weight: 2 }),
				finding({ severity: 'warning', category: 'actionability', weight: 1.5 }),
				finding({ severity: 'warning', category: 'clarity', weight: 1 }),
				finding({ severity: 'warning', category: 'technicalWriting', weight: 1 }),
			],
			config,
			words: 400,
			readingEase: 60,
		});

		expect(gramatical.score).toBeGreaterThan(estrutural.score);
		expect(gramatical.categories.grammar).toBeLessThan(10);
		expect(gramatical.categories.structure).toBe(10);
	});

	it('pondera por densidade: o mesmo problema pesa menos num texto longo', () => {
		const curto = calculateScore({ findings: [finding()], config, words: 100, readingEase: 60 });
		const longo = calculateScore({ findings: [finding()], config, words: 2000, readingEase: 60 });
		expect(longo.score).toBeGreaterThan(curto.score);
	});

	it('severidade diferente causa dano diferente', () => {
		const erro = calculateScore({ findings: [finding({ severity: 'error' })], config, words: 300, readingEase: 60 });
		const sugestao = calculateScore({
			findings: [finding({ severity: 'suggestion' })],
			config,
			words: 300,
			readingEase: 60,
		});
		expect(sugestao.score).toBeGreaterThan(erro.score);
	});

	it('peso diferente causa dano diferente (§49)', () => {
		const leve = calculateScore({ findings: [finding({ weight: 0.3 })], config, words: 300, readingEase: 60 });
		const grave = calculateScore({ findings: [finding({ weight: 3 })], config, words: 300, readingEase: 60 });
		expect(leve.score).toBeGreaterThan(grave.score);
	});

	it('info não afeta a nota', () => {
		const semInfo = calculateScore({ findings: [], config, words: 300, readingEase: 60 });
		const comInfo = calculateScore({
			findings: [finding({ severity: 'info', weight: 10 })],
			config,
			words: 300,
			readingEase: 60,
		});
		expect(comInfo.score).toBe(semInfo.score);
	});

	it('apresenta preparo para IA separado da nota editorial (§46)', () => {
		const score = calculateScore({
			findings: [finding({ category: 'aiReadiness', severity: 'warning', weight: 2 })],
			config,
			words: 200,
			readingEase: 60,
		});
		// A nota editorial não é afetada; o indicador de IA, sim.
		expect(score.score).toBeGreaterThan(9);
		expect(score.aiReadiness).toBeLessThan(10);
	});

	it('legibilidade usa platô e não domina a nota (§27)', () => {
		expect(readabilityToScore(80)).toBe(10);
		expect(readabilityToScore(50)).toBe(10);
		expect(readabilityToScore(30)).toBe(6);
		expect(readabilityToScore(0)).toBe(0);

		// Mesmo com legibilidade péssima, o peso de 5% limita o estrago.
		const score = calculateScore({ findings: [], config, words: 300, readingEase: 0 });
		expect(score.score).toBeGreaterThan(9);
	});

	it('atribui a faixa correta', () => {
		expect(bandFor(9.5, config.bands)).toBe('Excelente');
		expect(bandFor(8.2, config.bands)).toBe('Bom');
		expect(bandFor(7.1, config.bands)).toBe('Precisa melhorar');
		expect(bandFor(6.0, config.bands)).toBe('Fraco');
		expect(bandFor(2.0, config.bands)).toBe('Crítico');
	});

	it('arredonda para uma casa decimal (§47)', () => {
		expect(round1(8.6666)).toBe(8.7);
		const score = calculateScore({ findings: [finding()], config, words: 237, readingEase: 55 });
		expect(String(score.score).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
	});
});

// ---------------------------------------------------------- quality gate

describe('quality gate', () => {
	it('reprova abaixo da nota mínima', () => {
		expect(evaluateGate(7.2, { error: 0, warning: 0, suggestion: 0, info: 0 }, config)).toBe('fail');
	});

	it('reprova quando há erro e failOnErrors está ligado', () => {
		expect(evaluateGate(9.8, { error: 1, warning: 0, suggestion: 0, info: 0 }, config)).toBe('fail');
	});

	it('aprova com aviso quando só há warnings', () => {
		expect(evaluateGate(9.0, { error: 0, warning: 2, suggestion: 0, info: 0 }, config)).toBe('warning');
	});

	it('aprova quando está limpo', () => {
		expect(evaluateGate(9.0, { error: 0, warning: 0, suggestion: 1, info: 0 }, config)).toBe('pass');
	});

	it('gate desligado sempre aprova', () => {
		const off = mergeConfig(DEFAULT_CONFIG, { qualityGate: { enabled: false } }, 'off');
		expect(evaluateGate(1.0, { error: 9, warning: 0, suggestion: 0, info: 0 }, off)).toBe('pass');
	});

	it('failOnErrors desligado não reprova por erro isolado', () => {
		const lenient = mergeConfig(DEFAULT_CONFIG, { qualityGate: { failOnErrors: false } }, 'l');
		expect(evaluateGate(9.5, { error: 1, warning: 0, suggestion: 0, info: 0 }, lenient)).not.toBe('fail');
	});
});

// -------------------------------------------------------------- workspace

describe('relatório de workspace', () => {
	it('agrega notas, faixas e problemas mais frequentes', async () => {
		const results = [
			await lint(doc('Conteúdo correto e bem escrito nesta página de exemplo.'), 'a.md'),
			await lint(doc('![](/x.png)\n\n![](/y.png)'), 'b.md'),
		];

		const summary = summarizeWorkspace(results);
		expect(summary.analyzed).toBe(2);
		expect(summary.averageScore).toBeGreaterThan(0);
		expect(summary.topProblems.some((p) => p.ruleId === 'IMAGE-001')).toBe(true);
		expect(Object.keys(summary.bands).length).toBeGreaterThan(0);
	});

	it('workspace vazio não divide por zero', () => {
		const summary = summarizeWorkspace([]);
		expect(summary.analyzed).toBe(0);
		expect(summary.averageScore).toBe(0);
	});
});

// ------------------------------------------------------------ integração

describe('integração', () => {
	it('página bem escrita fica acima do mínimo e a ruim, abaixo', async () => {
		const boa = await lint(
			doc(
				[
					'## Autenticação',
					'',
					'Envie a chave no cabeçalho `Authorization` de cada requisição.',
					'',
					'```bash',
					'curl -H "Authorization: Bearer SUA_CHAVE" https://api.exemplo.com/v1/users',
					'```',
					'',
					'A resposta traz o status 200 e o corpo em JSON.',
				].join('\n')
			)
		);

		const ruim = await lint(
			doc(
				[
					'## Detalhes',
					'',
					'Nosso poderoso sistema oferece uma experiência incrível e revolucionária.',
					'',
					'TODO: escrever',
					'',
					'![](/x.png)',
					'',
					'Veja [clique aqui]().',
				].join('\n')
			)
		);

		expect(boa.score).toBeGreaterThanOrEqual(8);
		expect(boa.gate).not.toBe('fail');
		expect(ruim.score).toBeLessThan(boa.score);
		expect(ruim.gate).toBe('fail');
	});

	it('o resultado traz todas as categorias pontuadas', async () => {
		const result = await lint(doc('Texto simples de teste para a análise.'));
		for (const category of SCORED_CATEGORIES) {
			expect(typeof result.categories[category]).toBe('number');
		}
		expect(typeof result.aiReadiness).toBe('number');
	});

	it('findings vêm ordenados por posição', async () => {
		const result = await lint(doc('![](/a.png)\n\nTexto.\n\n![](/b.png)'));
		const lines = result.findings.map((f) => f.location.startLine);
		expect([...lines].sort((a, b) => a - b)).toEqual(lines);
	});

	it('a localização aponta para a linha real do arquivo', async () => {
		const result = await lint(doc('Linha um.\n\n![](/imagem.png)'));
		const image = result.findings.find((f) => f.ruleId === 'IMAGE-001');
		// frontmatter (4) + branco (5) + "Linha um." (6) + branco (7) = linha 8
		expect(image!.location.startLine).toBe(8);
	});
});
