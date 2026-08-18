import { describe, it, expect } from 'vitest';
import {
	VersionRegistryError,
	noticeFor,
	parseRegistry,
	redirectFor,
	resolvePath,
	versionedPath,
} from '../src/lib/versions/registry';

const REGISTRY = `versions:
  - id: v2
    label: Versão 2
    status: current
    branch: master
  - id: v1
    label: Versão 1
    status: deprecated
    branch: docs/v1
    supersededBy: v2
  - id: v3
    label: Versão 3
    status: draft
    branch: docs/v3
  - id: v0
    label: Versão 0
    status: archived
    tag: docs-v0
`;

const registry = parseRegistry(REGISTRY);

describe('leitura do registro', () => {
	it('lê as versões e identifica a atual', () => {
		expect(registry.versions.map((version) => version.id)).toEqual(['v2', 'v1', 'v3', 'v0']);
		expect(registry.current?.id).toBe('v2');
	});

	it('aceita branch ou tag como origem', () => {
		expect(registry.versions.find((version) => version.id === 'v1')?.branch).toBe('docs/v1');
		expect(registry.versions.find((version) => version.id === 'v0')?.tag).toBe('docs-v0');
	});

	it('o seletor deixa de fora rascunho e arquivada', () => {
		// Uma ainda não é pública, a outra deixou de ser — nenhuma das duas é
		// escolha razoável para quem está lendo agora.
		expect(registry.selectable.map((version) => version.id)).toEqual(['v2', 'v1']);
	});

	it('registro vazio não é erro', () => {
		expect(parseRegistry('').versions).toEqual([]);
		expect(parseRegistry('versions: []').current).toBeNull();
	});

	it('recusa duas versões atuais', () => {
		expect(() =>
			parseRegistry('versions:\n  - id: a\n    status: current\n  - id: b\n    status: current\n')
		).toThrow(/mais de uma versão/i);
	});

	it('recusa registro sem versão atual', () => {
		expect(() => parseRegistry('versions:\n  - id: a\n    status: maintained\n')).toThrow(/current/);
	});

	it('recusa id duplicado', () => {
		expect(() =>
			parseRegistry('versions:\n  - id: v1\n    status: current\n  - id: V1\n    status: maintained\n')
		).toThrow(/duplicada/);
	});

	it('recusa id que não serve para URL', () => {
		expect(() => parseRegistry('versions:\n  - id: "v 1"\n    status: current\n')).toThrow(/inválido/i);
		expect(() => parseRegistry('versions:\n  - id: "../etc"\n    status: current\n')).toThrow(/inválido/i);
	});

	it('recusa estado desconhecido', () => {
		expect(() => parseRegistry('versions:\n  - id: v1\n    status: antiga\n')).toThrow(/Estado desconhecido/);
	});

	it('recusa branch e tag na mesma versão', () => {
		// Duas origens só divergem no dia em que divergirem, e aí ninguém sabe
		// qual é a verdadeira.
		expect(() =>
			parseRegistry('versions:\n  - id: v1\n    status: current\n    branch: main\n    tag: v1.0\n')
		).toThrow(/branch e tag/);
	});

	it('recusa sucessora inexistente', () => {
		expect(() =>
			parseRegistry('versions:\n  - id: v1\n    status: current\n    supersededBy: v9\n')
		).toThrow(/não está no registro/);
	});

	it('recusa redirecionamento sem destino', () => {
		expect(() =>
			parseRegistry('versions:\n  - id: v1\n    status: current\n    redirect: true\n')
		).toThrow(/sem dizer para onde/);
	});

	it('YAML malformado vira erro com mensagem', () => {
		expect(() => parseRegistry('versions: [não fechado\n')).toThrow(VersionRegistryError);
	});
});

describe('resolução de caminho', () => {
	it('separa versão e caminho quando a URL a declara', () => {
		expect(resolvePath('/v1/guides/auth/', registry)).toMatchObject({
			path: '/guides/auth/',
			explicit: true,
		});
		expect(resolvePath('/v1/guides/auth/', registry).version?.id).toBe('v1');
	});

	it('sem prefixo, é a versão atual', () => {
		// Documentação sempre descreve alguma versão; fingir que não é o que
		// produz "isto ainda vale para o que eu uso?".
		const resolved = resolvePath('/guides/auth/', registry);
		expect(resolved.version?.id).toBe('v2');
		expect(resolved.explicit).toBe(false);
		expect(resolved.path).toBe('/guides/auth/');
	});

	it('não confunde pasta com versão', () => {
		expect(resolvePath('/guides/v1/', registry).version?.id).toBe('v2');
		expect(resolvePath('/guides/v1/', registry).path).toBe('/guides/v1/');
	});

	it('monta o caminho de cada versão', () => {
		const v1 = registry.versions.find((version) => version.id === 'v1')!;
		const v2 = registry.current!;

		expect(versionedPath('/guides/auth/', v1, registry)).toBe('/v1/guides/auth/');
		// A atual não recebe prefixo: a URL curta é a que se compartilha.
		expect(versionedPath('/guides/auth/', v2, registry)).toBe('/guides/auth/');
	});
});

describe('avisos de ciclo de vida', () => {
	function version(id: string) {
		return registry.versions.find((candidate) => candidate.id === id)!;
	}

	it('versão obsoleta avisa e aponta a sucessora', () => {
		const notice = noticeFor(version('v1'), registry, '/guides/auth/');
		expect(notice?.kind).toBe('deprecated');
		expect(notice?.message).toContain('obsoleta');
		expect(notice?.href).toBe('/guides/auth/');
		expect(notice?.label).toBe('Versão 2');
	});

	it('versão arquivada diz que continua no ar para consulta', () => {
		expect(noticeFor(version('v0'), registry)?.kind).toBe('archived');
	});

	it('rascunho avisa que o conteúdo ainda muda', () => {
		const notice = noticeFor(version('v3'), registry);
		expect(notice?.kind).toBe('draft');
		// Rascunho não manda para outra versão: ele é o que está sendo escrito.
		expect(notice?.href).toBeUndefined();
	});

	it('versão atual e mantida não geram aviso', () => {
		expect(noticeFor(version('v2'), registry)).toBeNull();
		const maintained = parseRegistry('versions:\n  - id: a\n    status: current\n  - id: b\n    status: maintained\n');
		expect(noticeFor(maintained.versions[1], maintained)).toBeNull();
	});

	it('sem versão, não há aviso', () => {
		expect(noticeFor(null, registry)).toBeNull();
	});
});

describe('redirecionamento', () => {
	it('só redireciona quando a versão pede', () => {
		expect(redirectFor(registry.versions.find((version) => version.id === 'v1')!, registry)).toBeNull();

		const withRedirect = parseRegistry(
			'versions:\n  - id: v2\n    status: current\n  - id: v1\n    status: deprecated\n    supersededBy: v2\n    redirect: true\n'
		);
		const v1 = withRedirect.versions.find((version) => version.id === 'v1')!;
		expect(redirectFor(v1, withRedirect, '/guides/auth/')).toBe('/guides/auth/');
	});
});
