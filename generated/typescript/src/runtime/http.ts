// Gerado. Não edite à mão.

import { ApiError, NotFoundError, RateLimitError, ServerError, UnauthorizedError, ValidationError } from '../errors.js';
import { applyAuth, type AuthOptions } from './auth.js';
import { buildPath, buildQuery } from './serialization.js';

export interface RequestOptions {
	method: string;
	path: string;
	pathParams?: Record<string, unknown>;
	query?: Record<string, unknown>;
	headers?: Record<string, unknown>;
	body?: unknown;
	contentType?: string;
}

export interface TransportOptions extends AuthOptions {
	baseUrl: string;
	/** Milissegundos. O padrão evita que uma chamada pendurada trave quem chama. */
	timeoutMs?: number;
	/** Injetável para teste. O padrão é o `fetch` global. */
	fetch?: typeof globalThis.fetch;
	/** Cabeçalhos aplicados a toda requisição. */
	headers?: Record<string, string>;
}

export class Transport {
	constructor(private readonly options: TransportOptions) {}

	async request<T>(request: RequestOptions): Promise<T> {
		const fetchImpl = this.options.fetch ?? globalThis.fetch;
		if (!fetchImpl) throw new Error('Nenhuma implementação de fetch disponível.');

		const path = buildPath(request.path, request.pathParams ?? {});
		const query = buildQuery(request.query ?? {});
		const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}${query}`;

		const headers: Record<string, string> = { Accept: 'application/json', ...this.options.headers };

		for (const [name, value] of Object.entries(request.headers ?? {})) {
			if (value !== undefined && value !== null) headers[name] = String(value);
		}

		if (request.body !== undefined) headers['Content-Type'] = request.contentType ?? 'application/json';

		applyAuth(headers, this.options);

		// O tempo limite é do SDK, não do servidor: sem ele, uma conexão pendurada
		// trava quem chamou sem nunca resolver nem rejeitar.
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);

		let response: Response;
		try {
			response = await fetchImpl(url, {
				method: request.method,
				headers,
				body: request.body === undefined ? undefined : JSON.stringify(request.body),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
		}

		const text = await response.text();
		const payload = parse(text, response.headers.get('content-type'));

		if (!response.ok) throw errorFor(response.status, response.statusText, payload);

		return payload as T;
	}
}

function parse(text: string, contentType: string | null): unknown {
	if (text === '') return undefined;
	if (contentType && !contentType.includes('json')) return text;

	try {
		return JSON.parse(text);
	} catch {
		// Corpo que não é JSON válido volta como texto. Lançar aqui esconderia a
		// resposta do servidor justamente quando ela é a pista do problema.
		return text;
	}
}

function errorFor(status: number, statusText: string, payload: unknown): ApiError {
	const message = messageOf(payload) ?? statusText ?? `HTTP ${status}`;

	switch (status) {
		case 400:
		case 422:
			return new ValidationError(message, status, payload);
		case 401:
		case 403:
			return new UnauthorizedError(message, status, payload);
		case 404:
			return new NotFoundError(message, status, payload);
		case 429:
			return new RateLimitError(message, status, payload);
		default:
			return status >= 500 ? new ServerError(message, status, payload) : new ApiError(message, status, payload);
	}
}

function messageOf(payload: unknown): string | undefined {
	if (!payload || typeof payload !== 'object') return undefined;
	const record = payload as Record<string, unknown>;

	for (const key of ['message', 'error', 'detail', 'title']) {
		const value = record[key];
		if (typeof value === 'string' && value.trim() !== '') return value;
	}

	return undefined;
}
