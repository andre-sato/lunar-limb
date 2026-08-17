import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	canUseChat,
	ChatError,
	excerptFrom,
	MAX_QUERY_CHARS,
	normalizeQuery,
	searchDocumentation,
} from '../src/lib/chat/search';
import {
	checkRateLimit,
	createConversation,
	getConversation,
	resetChatState,
	trimConversation,
} from '../src/lib/chat/store';
import { localeOfPath, normalizeLocale, toSourceReferences, urlForPath } from '../src/lib/chat/retrieval';
import type { ChatUser, RetrievedChunk } from '../src/lib/chat/types';

const viewer: ChatUser = { id: 'u-viewer', role: 'viewer', status: 'active' };
const admin: ChatUser = { id: 'u-admin', role: 'admin', status: 'active' };

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
	return {
		id: 'c1',
		documentId: 'api-reference/authentication.md',
		path: 'api-reference/authentication.md',
		title: 'Autenticação',
		heading: 'Chaves de API',
		content: 'Document: Autenticação\nSection: Chaves de API\n\nEnvie a chave no header Authorization.',
		url: '/api-reference/authentication/#chaves-de-api',
		kind: 'page',
		score: 1,
		...overrides,
	};
}

const rateLimitChunk = chunk({
	id: 'c2',
	documentId: 'api-reference/overview.md',
	path: 'api-reference/overview.md',
	title: 'Visão geral',
	heading: 'Limites',
	content: 'Document: Visão geral\nSection: Limites\n\nO limite é de 600 requisições por minuto.',
	url: '/api-reference/overview/#limites',
	score: 0.8,
});

vi.mock('../src/lib/chat/retrieval', async () => {
	const actual = await vi.importActual<typeof import('../src/lib/chat/retrieval')>(
		'../src/lib/chat/retrieval'
	);
	return {
		...actual,
		retrieveDocumentation: vi.fn(async (query: string) => {
			if (query.includes('inexistente')) return [];
			if (query.includes('limite')) return [rateLimitChunk];
			return [chunk(), rateLimitChunk];
		}),
	};
});

beforeEach(() => {
	resetChatState();
});

describe('busca na documentação', () => {
	it('devolve trechos com o link da página', async () => {
		const conversation = createConversation(viewer);
		const answer = await searchDocumentation(conversation, 'como autenticar?', viewer);

		expect(answer.empty).toBe(false);
		expect(answer.excerpts).toHaveLength(2);
		expect(answer.excerpts[0].url).toBe('/api-reference/authentication/#chaves-de-api');
		expect(answer.excerpts[0].title).toBe('Autenticação');
		expect(answer.excerpts[0].section).toBe('Chaves de API');
	});

	it('o texto do trecho é o da documentação, sem o cabeçalho do indexador', async () => {
		// `Document:`/`Section:` existem para a busca, não para o leitor: a
		// interface já mostra título e seção.
		const answer = await searchDocumentation(createConversation(viewer), 'como autenticar?', viewer);
		expect(answer.excerpts[0].text).toBe('Envie a chave no header Authorization.');
		expect(answer.excerpts[0].text).not.toContain('Document:');
	});

	it('a mensagem é uma frase de enquadramento, não uma resposta', async () => {
		const answer = await searchDocumentation(createConversation(viewer), 'como autenticar?', viewer);
		// O que responde são os trechos. A frase só diz quantos são.
		expect(answer.message).toMatch(/^Encontrei 2 trechos/);
		expect(answer.message.length).toBeLessThan(80);
	});

	it('usa o singular quando há um só trecho', async () => {
		const answer = await searchDocumentation(createConversation(viewer), 'qual o limite?', viewer);
		expect(answer.message).toMatch(/^Encontrei este trecho/);
	});

	it('sem resultado, diz que não encontrou e sugere o que fazer', async () => {
		const answer = await searchDocumentation(
			createConversation(viewer),
			'configurar o módulo inexistente',
			viewer
		);
		expect(answer.empty).toBe(true);
		expect(answer.excerpts).toEqual([]);
		expect(answer.message).toMatch(/não encontrei/i);
		expect(answer.message).toMatch(/nome exato/i);
	});

	it('registra os dois turnos na conversa', async () => {
		const conversation = createConversation(viewer);
		await searchDocumentation(conversation, 'como autenticar?', viewer);

		expect(conversation.messages).toHaveLength(2);
		expect(conversation.messages[0].role).toBe('user');
		expect(conversation.messages[1].excerpts).toHaveLength(2);
	});

	it('rejeita consulta vazia e consulta longa demais', async () => {
		const conversation = createConversation(viewer);
		await expect(searchDocumentation(conversation, '   ', viewer)).rejects.toBeInstanceOf(ChatError);
		await expect(
			searchDocumentation(conversation, 'a'.repeat(MAX_QUERY_CHARS + 1), viewer)
		).rejects.toMatchObject({ code: 'too_long' });
	});

	it('recusa usuário inativo, qualquer que seja o papel', async () => {
		const inactive: ChatUser = { id: 'u-x', role: 'admin', status: 'inactive' };
		await expect(
			searchDocumentation(createConversation(inactive), 'oi', inactive)
		).rejects.toMatchObject({ code: 'unauthorized' });
	});

	it('não há prompt nem modelo no caminho da busca', async () => {
		// Garante que a simplificação não voltou pela porta de trás: se alguém
		// reintroduzir um provedor de LLM aqui, este teste cai.
		const module = await import('../src/lib/chat/search?raw').catch(() => null);
		const source = module
			? String((module as { default?: string }).default ?? '')
			: (await import('node:fs')).readFileSync('src/lib/chat/search.ts', 'utf-8');

		for (const forbidden of ['anthropic', 'openai', 'systemPrompt', 'max_tokens']) {
			expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
		}
	});
});

describe('recorte do trecho', () => {
	it('corta no fim de frase, não no meio', () => {
		const long = chunk({
			content: 'Primeira frase completa. Segunda frase que estoura o limite estabelecido aqui.',
		});
		const excerpt = excerptFrom(long, 30)!;
		expect(excerpt.text).toBe('Primeira frase completa.');
	});

	it('quando não há fim de frase próximo, corta com reticências', () => {
		const excerpt = excerptFrom(chunk({ content: 'palavra '.repeat(50) }), 40)!;
		expect(excerpt.text.endsWith('…')).toBe(true);
		expect(excerpt.text.length).toBeLessThanOrEqual(41);
	});

	it('não recorta o que já cabe', () => {
		const excerpt = excerptFrom(chunk({ content: 'Texto curto.' }), 500)!;
		expect(excerpt.text).toBe('Texto curto.');
	});

	it('redige credencial que tenha vazado para a documentação', () => {
		const leaked = chunk({
			content: 'Use a chave sk-ant-api03-RealLookingKeyMaterial0123456789abcd no header.',
		});
		const excerpt = excerptFrom(leaked, 500)!;
		expect(excerpt.text).not.toContain('RealLookingKeyMaterial');
		expect(excerpt.text).toContain('credencial removida');
	});

	it('bloco reutilizável aponta para a página que o inclui, não para si mesmo', () => {
		// O `url` que o indexador guarda para um bloco (`/rate-limit/`) responde
		// 404: bloco não tem página. Isto apareceu na verificação por HTTP.
		const snippet = chunk({
			path: 'rate-limit.md',
			documentId: 'rate-limit.md',
			kind: 'snippet',
			url: '/rate-limit/',
			heading: undefined,
			usedBy: ['api-reference/overview.md'],
			content: 'Limite de 600 requisições por minuto.',
		});

		const excerpt = excerptFrom(snippet, 500)!;
		expect(excerpt.url).toBe('/api-reference/overview/');
		expect(excerpt.url).not.toBe('/rate-limit/');
		// E o leitor é avisado de onde o texto vem, para não estranhar a página.
		expect(excerpt.section).toContain('usado em');
	});

	it('bloco sem página consumidora é descartado em vez de virar link morto', () => {
		const orphan = chunk({
			path: 'orfao.md',
			kind: 'snippet',
			url: '/orfao/',
			usedBy: [],
			content: 'Texto de um bloco que ninguém inclui.',
		});
		expect(excerptFrom(orphan, 500)).toBeNull();
	});

	it('preserva o placeholder que a documentação precisa mostrar', () => {
		const excerpt = excerptFrom(chunk({ content: 'Authorization: Bearer <SUA_CHAVE_DE_API>' }), 500)!;
		expect(excerpt.text).toContain('SUA_CHAVE_DE_API');
	});
});

describe('consulta de acompanhamento', () => {
	const history = [
		{ role: 'user', content: 'Como funciona a autenticação da API?' },
		{ role: 'assistant', content: 'Encontrei 2 trechos na documentação:' },
	];

	it('junta o assunto anterior a uma pergunta curta', () => {
		const query = normalizeQuery('e a expiração?', history);
		expect(query).toContain('autenticação');
		expect(query).toContain('expiração');
	});

	it('não altera consulta autossuficiente', () => {
		const full = 'Como configuro webhooks para receber notificações de pagamento?';
		expect(normalizeQuery(full, history)).toBe(full);
	});

	it('sem histórico, devolve a consulta como veio', () => {
		expect(normalizeQuery('e agora?', [])).toBe('e agora?');
	});
});

describe('autorização', () => {
	it('os três papéis podem buscar', () => {
		for (const role of ['viewer', 'editor', 'admin'] as const) {
			expect(canUseChat({ id: 'u', role, status: 'active' })).toBe(true);
		}
	});

	it('anônimo e inativo não podem', () => {
		expect(canUseChat(null)).toBe(false);
		expect(canUseChat({ id: 'u', role: 'admin', status: 'inactive' })).toBe(false);
	});
});

describe('conversas e limite de uso', () => {
	it('a conversa é acessível só pelo dono', () => {
		const conversation = createConversation(viewer);
		expect(getConversation(conversation.id, viewer)?.id).toBe(conversation.id);
		// Nem um admin lê a conversa de outra pessoa: o id vem do cliente.
		expect(getConversation(conversation.id, admin)).toBeNull();
	});

	it('recorta o histórico longo', () => {
		const conversation = createConversation(viewer);
		for (let index = 0; index < 90; index++) {
			conversation.messages.push({
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `mensagem ${index}`,
				timestamp: '2026-08-17T00:00:00Z',
			});
		}
		trimConversation(conversation);
		expect(conversation.messages.length).toBeLessThanOrEqual(60);
	});

	it('libera até o limite e barra depois', () => {
		for (let index = 0; index < 3; index++) {
			expect(checkRateLimit('u-1', 3).allowed).toBe(true);
		}
		const blocked = checkRateLimit('u-1', 3);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfter).toBeGreaterThan(0);
	});

	it('o limite é por usuário', () => {
		checkRateLimit('u-1', 1);
		expect(checkRateLimit('u-1', 1).allowed).toBe(false);
		expect(checkRateLimit('u-2', 1).allowed).toBe(true);
	});
});

describe('fontes e idioma', () => {
	it('bloco reutilizável cita as páginas consumidoras, não a si mesmo', () => {
		const snippet: RetrievedChunk = chunk({
			documentId: 'rate-limit.md',
			path: 'rate-limit.md',
			kind: 'snippet',
			usedBy: ['api-reference/overview.md', 'guides/getting-started.md'],
			url: '/rate-limit/',
		});

		const sources = toSourceReferences([snippet]);
		expect(sources).toHaveLength(2);
		expect(sources.map((source) => source.url)).not.toContain('/rate-limit/');
	});

	it('não repete a mesma página', () => {
		const base = chunk();
		expect(toSourceReferences([base, { ...base, id: 'outro', score: 0.4 }])).toHaveLength(1);
	});

	it('identifica o idioma pelo prefixo do caminho', () => {
		expect(localeOfPath('en/guides/auth.md')).toBe('en');
		expect(localeOfPath('guides/auth.md')).toBe('default');
		// `enterprise/` começa com "en" e não é inglês.
		expect(localeOfPath('enterprise/guia.md')).toBe('default');
	});

	it('normaliza o idioma do cliente contra as traduções existentes', () => {
		expect(normalizeLocale('en-US')).toBe('en');
		expect(normalizeLocale('pt-BR')).toBe('default');
		// Entrada arbitrária não escapa da lista.
		expect(normalizeLocale('../../etc')).toBe('default');
	});

	it('monta a URL pública a partir do caminho', () => {
		expect(urlForPath('guides/auth.md')).toBe('/guides/auth/');
		expect(urlForPath('index.mdx')).toBe('/');
	});
});
