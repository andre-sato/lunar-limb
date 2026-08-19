import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { visibleRepositories } from '../src/lib/org/config';
import { resolveRepositoryPath, scanRepository } from '../src/lib/org/scan';
import { EMPTY_ORGANIZATION, type OrganizationConfig } from '../src/lib/org/types';

let fixture: string;

beforeAll(async () => {
	fixture = await mkdtemp(path.join(tmpdir(), 'org-fixture-'));
	await mkdir(path.join(fixture, 'docs', 'sub'), { recursive: true });

	await writeFile(
		path.join(fixture, 'docs', 'intro.md'),
		[
			'---',
			'title: Introdução',
			'owner: payments-team',
			'---',
			'',
			'Veja [sub](./sub/detalhe) e [quebrado](./nao-existe).',
			'Também [outro repo](repo://checkout/fluxo) e [desconhecido](repo://inexistente/x).',
			'E um [externo](https://exemplo.com) que não conta.',
			'',
		].join('\n'),
		'utf-8'
	);

	await writeFile(
		path.join(fixture, 'docs', 'sub', 'detalhe.md'),
		'---\ntitle: Detalhe\n---\n\nSem dono declarado.\n',
		'utf-8'
	);

	// Diretório oculto e node_modules não devem ser percorridos.
	await mkdir(path.join(fixture, 'docs', 'node_modules'), { recursive: true });
	await writeFile(path.join(fixture, 'docs', 'node_modules', 'ruido.md'), '# ruído\n', 'utf-8');
});

afterAll(async () => {
	await rm(fixture, { recursive: true, force: true });
});

describe('resolveRepositoryPath', () => {
	it('aceita caminho absoluto', () => {
		expect(resolveRepositoryPath({ id: 'x', path: fixture })).toBe(fixture);
	});

	it('sem path não há caminho a resolver', () => {
		expect(resolveRepositoryPath({ id: 'x', url: 'https://exemplo.com/x' })).toBeNull();
	});
});

describe('scanRepository', () => {
	it('conta páginas e donos declarados', async () => {
		const report = await scanRepository({ id: 'fixture', path: fixture, docs: 'docs' });

		expect(report.depth).toBe('files');
		expect(report.pages).toBe(2);
		expect(report.owned).toBe(1);
	});

	it('não percorre node_modules', async () => {
		const report = await scanRepository({ id: 'fixture', path: fixture, docs: 'docs' });
		expect(report.pages).toBe(2);
	});

	it('conta link interno quebrado e ignora link externo', async () => {
		const report = await scanRepository({ id: 'fixture', path: fixture, docs: 'docs' });
		expect(report.brokenLinks).toBe(1);
	});

	it('reconhece referência cruzada explícita', async () => {
		const report = await scanRepository({ id: 'fixture', path: fixture, docs: 'docs' }, { siblings: ['checkout'] });

		expect(report.crossReferences).toHaveLength(2);
		expect(report.crossReferences.find((entry) => entry.repository === 'checkout')?.resolved).toBe(true);
		expect(report.crossReferences.find((entry) => entry.repository === 'inexistente')?.resolved).toBe(false);
	});

	it('não inventa saúde para repositório lido pelos arquivos', async () => {
		// Uma nota derivada de contagem de páginas seria comparável com a do portal
		// e não teria nada por trás.
		const report = await scanRepository({ id: 'fixture', path: fixture, docs: 'docs' });

		expect(report.health).toBeNull();
		expect(report.gaps).toBeNull();
	});

	it('repositório só com URL é listado e não lido', async () => {
		const report = await scanRepository({ id: 'remoto', url: 'https://exemplo.com/x' });

		expect(report.depth).toBe('unreachable');
		expect(report.reason).toContain('não busca repositório da rede');
	});

	it('caminho que não existe não derruba a coleta', async () => {
		const report = await scanRepository({ id: 'sumido', path: path.join(fixture, 'nao-existe') });

		expect(report.depth).toBe('unreachable');
		expect(report.pages).toBe(0);
	});

	it('diretório de docs errado é reportado, não confundido com repositório vazio', async () => {
		const report = await scanRepository({ id: 'fixture', path: fixture, docs: 'documentacao' });

		expect(report.depth).toBe('unreachable');
		expect(report.reason).toContain('não existe');
	});
});

describe('visibleRepositories', () => {
	const config: OrganizationConfig = {
		...EMPTY_ORGANIZATION,
		repositories: [
			{ id: 'aberto' },
			{ id: 'restrito', visibleTo: ['admin'] },
			{ id: 'vazio', visibleTo: [] },
		],
	};

	it('repositório sem restrição é visível para todos', () => {
		expect(visibleRepositories(config, 'viewer').map((entry) => entry.id)).toContain('aberto');
	});

	it('lista vazia não é restrição', () => {
		expect(visibleRepositories(config, 'viewer').map((entry) => entry.id)).toContain('vazio');
	});

	it('repositório restrito não aparece para papel de fora', () => {
		expect(visibleRepositories(config, 'viewer').map((entry) => entry.id)).not.toContain('restrito');
	});

	it('repositório restrito aparece para o papel declarado', () => {
		expect(visibleRepositories(config, 'admin').map((entry) => entry.id)).toContain('restrito');
	});

	it('sem papel, o restrito continua invisível', () => {
		expect(visibleRepositories(config, undefined).map((entry) => entry.id)).not.toContain('restrito');
	});
});
