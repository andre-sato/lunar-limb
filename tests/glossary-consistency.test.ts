import { describe, it, expect, afterAll } from 'vitest';
import { lintDocument } from '../src/lib/linter/lint';
import { loadConfig } from '../src/lib/linter/config';
import { buildGlossaryIndex } from '../src/lib/glossary/index-build';
import { setGlossaryIndex } from '../src/lib/linter/rules/glossary';
import { ALL_RULES, duplicateRuleIds } from '../src/lib/linter/rules';
import type { GlossDef } from '../src/lib/glossary/types';

function def(partial: Partial<GlossDef> & { id: string; term: string }): GlossDef {
	return {
		aliases: [],
		definition: 'Definição.',
		enabled: true,
		caseSensitive: false,
		matchWholeWord: true,
		deprecated: [],
		...partial,
	};
}

const GLOSSARY = buildGlossaryIndex([
	def({ id: 'api', term: 'API', aliases: ['Application Programming Interface'] }),
	def({ id: 'api-key', term: 'API key', aliases: ['chave de API'], deprecated: ['API-Key', 'apikey'] }),
	def({ id: 'allowlist', term: 'allowlist', deprecated: ['whitelist'] }),
]);

setGlossaryIndex(GLOSSARY);
afterAll(() => setGlossaryIndex(null));

const config = await loadConfig('default');

async function lint(body: string) {
	const raw = `---\ntitle: Página de teste\ndescription: Texto para exercitar as regras de consistência do glossário.\n---\n\n${body}\n`;
	const result = await lintDocument(raw, { path: 'guides/teste.md', config });
	return result.findings;
}

function ids(findings: Awaited<ReturnType<typeof lint>>): string[] {
	return findings.map((finding) => finding.ruleId);
}

describe('o glossário alimenta a categoria consistency', () => {
	it('as regras pertencem a consistency, não a uma categoria própria', () => {
		// A spec é explícita: terminologia não vira uma dimensão separada do
		// score — ela é consistência (§30.1, §34).
		for (const id of ['CONSISTENCY-002', 'CONSISTENCY-003', 'CONSISTENCY-004', 'CONSISTENCY-005']) {
			const rule = ALL_RULES.find((candidate) => candidate.id === id);
			expect(rule, id).toBeDefined();
			expect(rule!.category).toBe('consistency');
		}
	});

	it('nenhum id de regra colide', () => {
		expect(duplicateRuleIds()).toEqual([]);
	});
});

describe('CONSISTENCY-003 — terminologia desaconselhada', () => {
	it('acusa o termo desaconselhado e sugere o canônico', async () => {
		const findings = await lint(
			'A whitelist de endereços precisa ser revisada antes de cada implantação do serviço.'
		);
		const finding = findings.find((item) => item.ruleId === 'CONSISTENCY-003');

		expect(finding).toBeDefined();
		expect(finding!.message).toContain('whitelist');
		expect(finding!.suggestion).toBe('allowlist');
		// §35: o resultado aponta o GlossDef correspondente.
		expect(finding!.explanation).toContain('allowlist');
	});

	it('não acusa quando a página já usa o termo canônico', async () => {
		const findings = await lint('A allowlist de endereços precisa ser revisada antes de cada implantação.');
		expect(ids(findings)).not.toContain('CONSISTENCY-003');
	});

	it('ignora o termo dentro de código', async () => {
		// O mesmo princípio do destaque: código é literal, não prosa.
		const findings = await lint('Use `whitelist` como nome do campo na requisição enviada ao serviço.');
		expect(ids(findings)).not.toContain('CONSISTENCY-003');
	});
});

describe('CONSISTENCY-002 — forma não preferencial', () => {
	it('acusa quando alias e forma canônica convivem na página', async () => {
		const findings = await lint(
			'A Application Programming Interface responde em JSON. A API também aceita envio de formulário.'
		);
		const finding = findings.find((item) => item.ruleId === 'CONSISTENCY-002');

		expect(finding).toBeDefined();
		expect(finding!.suggestion).toBe('API');
	});

	it('não acusa quando só o alias aparece', async () => {
		// Uma página que escolheu a forma extensa e a mantém não é inconsistente.
		const findings = await lint(
			'A Application Programming Interface responde sempre em JSON, com os mesmos campos.'
		);
		expect(ids(findings)).not.toContain('CONSISTENCY-002');
	});
});

describe('CONSISTENCY-005 — sigla e forma extensa', () => {
	it('aceita a apresentação da sigla uma vez', async () => {
		const findings = await lint(
			'A Application Programming Interface (API) responde em JSON. A API aceita envio de formulário também.'
		);
		expect(ids(findings)).not.toContain('CONSISTENCY-005');
	});

	it('acusa a partir da segunda repetição da forma extensa', async () => {
		const findings = await lint(
			[
				'A Application Programming Interface responde em JSON e aceita formulário.',
				'',
				'A API registra o pedido no histórico da conta do cliente.',
				'',
				'Cada Application Programming Interface publicada segue o mesmo contrato.',
			].join('\n')
		);
		expect(ids(findings)).toContain('CONSISTENCY-005');
	});
});

describe('CONSISTENCY-004 — sigla sem definição', () => {
	it('acusa sigla repetida que não está no glossário', async () => {
		const findings = await lint(
			[
				'O RAG combina recuperação e geração para responder perguntas do time.',
				'',
				'Cada consulta ao RAG registra a origem usada na resposta apresentada.',
				'',
				'O RAG também alimenta o relatório mensal de uso da documentação.',
			].join('\n')
		);
		const finding = findings.find((item) => item.ruleId === 'CONSISTENCY-004');

		expect(finding).toBeDefined();
		expect(finding!.message).toContain('RAG');
	});

	it('não acusa sigla universal', async () => {
		// A regra procura vocabulário do produto, não exige definir HTTP.
		const findings = await lint(
			[
				'A resposta HTTP traz o corpo em JSON com os campos combinados.',
				'',
				'Todo erro HTTP segue o mesmo formato descrito na referência.',
				'',
				'O cabeçalho HTTP de autenticação é obrigatório em cada chamada.',
			].join('\n')
		);
		expect(ids(findings)).not.toContain('CONSISTENCY-004');
	});

	it('não acusa sigla que está no glossário', async () => {
		const findings = await lint(
			[
				'A API responde em JSON com os campos definidos no contrato publicado.',
				'',
				'Cada chamada da API registra a origem no histórico da conta.',
				'',
				'A API aceita formulário quando o cabeçalho informa o tipo correto.',
			].join('\n')
		);
		expect(ids(findings)).not.toContain('CONSISTENCY-004');
	});

	it('não acusa aparição isolada', async () => {
		// Uma menção não é vocabulário estabelecido.
		const findings = await lint('O relatório usa XPTO apenas nesta frase, como exemplo de sigla solta.');
		expect(ids(findings)).not.toContain('CONSISTENCY-004');
	});
});

describe('sem glossário carregado', () => {
	it('as regras ficam quietas', async () => {
		setGlossaryIndex(null);
		const findings = await lint('A whitelist de endereços precisa de revisão antes de cada implantação.');
		expect(ids(findings)).not.toContain('CONSISTENCY-003');
		setGlossaryIndex(GLOSSARY);
	});
});
