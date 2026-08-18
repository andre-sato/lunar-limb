import { describe, it, expect } from 'vitest';
import { firstSentence, summarize } from '../src/lib/chat/summary';
import type { Excerpt } from '../src/lib/chat/types';

function excerpt(text: string, overrides: Partial<Excerpt> = {}): Excerpt {
	return {
		title: 'Autenticação',
		section: 'Chaves de API',
		text,
		url: '/guides/auth/',
		path: 'guides/auth.md',
		score: 1,
		...overrides,
	};
}

describe('extração da primeira frase', () => {
	it('pega a primeira frase de um parágrafo', () => {
		const text = 'As chaves de API são enviadas no header Authorization. O restante vem depois.';
		expect(firstSentence(text)).toBe('As chaves de API são enviadas no header Authorization.');
	});

	it('não corta em abreviação nem em número com ponto', () => {
		// "req/min." seguido de minúscula não termina a frase.
		const text = 'O limite é de 100 req/min. por chave e vale para todos os endpoints.';
		expect(firstSentence(text)).toBe('O limite é de 100 req/min. por chave e vale para todos os endpoints.');
	});

	it('pula título, lista, tabela e bloco de código', () => {
		const text = [
			'## Chaves de API',
			'- item de lista que não resume',
			'| coluna | outra |',
			'```bash',
			'curl -H "Authorization: Bearer x" https://api.exemplo.com',
			'```',
			'A chave é criada no painel e não pode ser recuperada depois.',
		].join('\n');
		expect(firstSentence(text)).toBe('A chave é criada no painel e não pode ser recuperada depois.');
	});

	it('ignora import de MDX e linha que é só um link', () => {
		const text = [
			"import { Card } from '@astrojs/starlight/components';",
			'[Veja a referência](/api-reference/overview/)',
			'A autenticação usa um token de portador enviado em cada requisição.',
		].join('\n');
		expect(firstSentence(text)).toBe('A autenticação usa um token de portador enviado em cada requisição.');
	});

	it('descarta frase curta demais para informar', () => {
		expect(firstSentence('Veja também.')).toBeNull();
		expect(firstSentence('Nota:')).toBeNull();
	});

	it('trunca frase longa numa fronteira de palavra', () => {
		const long = `${'palavra '.repeat(60)}fim.`;
		const sentence = firstSentence(long)!;
		expect(sentence.length).toBeLessThanOrEqual(241);
		expect(sentence.endsWith('…')).toBe(true);
		expect(sentence).not.toMatch(/palavr…$/); // não corta no meio da palavra
	});

	it('devolve null quando não há prosa nenhuma', () => {
		expect(firstSentence('```\ncódigo\n```')).toBeNull();
		expect(firstSentence('| a | b |\n| - | - |')).toBeNull();
	});
});

describe('resumo da resposta', () => {
	it('cita a frase e declara a origem', () => {
		const summary = summarize([excerpt('As chaves de API são enviadas no header Authorization.')]);
		expect(summary).toContain('Autenticação — Chaves de API');
		expect(summary).toContain('"As chaves de API são enviadas no header Authorization."');
	});

	it('conta trechos e páginas', () => {
		const summary = summarize([
			excerpt('As chaves de API são enviadas no header Authorization.'),
			excerpt('Outro trecho da mesma página com texto suficiente para contar.', { section: 'Erros' }),
			excerpt('Um trecho de outra página, com tamanho suficiente para servir.', {
				path: 'guides/rate-limit.md',
				title: 'Limites',
			}),
		]);
		expect(summary).toContain('3 trechos de 2 páginas');
	});

	it('concorda no singular', () => {
		const summary = summarize([excerpt('As chaves de API são enviadas no header Authorization.')]);
		expect(summary).toContain('1 trecho de 1 página');
	});

	it('usa o trecho seguinte quando o primeiro não tem prosa', () => {
		// O mais relevante pode ser uma tabela de erros; o resumo não desiste.
		const summary = summarize([
			excerpt('| Código | Significado |\n| --- | --- |\n| 429 | Limite excedido |', { title: 'Erros' }),
			excerpt('O limite padrão é de cem requisições por minuto para cada chave.', { title: 'Limites' }),
		]);
		expect(summary).toContain('Limites');
		expect(summary).toContain('cem requisições por minuto');
	});

	it('cai no enquadramento simples quando nenhum trecho tem prosa', () => {
		// Dizer menos é melhor que dizer errado: sem frase citável, não há resumo.
		const summary = summarize([excerpt('```json\n{"a": 1}\n```', { title: 'Exemplo' })]);
		expect(summary).toBe('Encontrei 1 trecho de 1 página.');
		expect(summary).not.toContain('"');
	});

	it('sem trechos, não há resumo', () => {
		expect(summarize([])).toBe('');
	});

	it('o resumo não inventa: cada frase citada está no trecho', () => {
		const texto = 'O token expira em 90 dias e precisa ser renovado pelo painel.';
		const summary = summarize([excerpt(texto)]);
		const citada = summary.match(/"([^"]+)"/)?.[1];
		expect(citada).toBeDefined();
		expect(texto).toContain(citada!);
	});
});

describe('marcação na frase citada', () => {
	it('tira negrito, itálico e código inline', () => {
		expect(firstSentence('Mude o status para **Inativo** quando alguém sair da equipe.')).toBe(
			'Mude o status para Inativo quando alguém sair da equipe.'
		);
		expect(firstSentence('A resposta usa o código `401` para credencial ausente ou inválida.')).toBe(
			'A resposta usa o código 401 para credencial ausente ou inválida.'
		);
	});

	it('de um link, mantém o rótulo e descarta a URL', () => {
		expect(
			firstSentence('Consulte a [referência da API](/api-reference/overview/) antes de integrar.')
		).toBe('Consulte a referência da API antes de integrar.');
	});

	it('não come asterisco que faz parte do texto', () => {
		const text = 'O padrão glob aceita a forma docs/*.md para casar com vários arquivos.';
		expect(firstSentence(text)).toBe(text);
	});
});
