import type { APIRoute } from 'astro';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseOpenApi } from '../../../lib/api-explorer/model';
import { readJsonObject } from '../../../lib/auth/api';
import {
	allowedOrigins,
	checkTarget,
	redactHeaders,
	sanitizeHeaders,
} from '../../../lib/api-explorer/proxy-policy';

export const prerender = false;

/**
 * Proxy do "Try it" (§4, §11).
 *
 * Ele existe porque a API documentada raramente aceita CORS do domínio do
 * portal. E é justamente por existir que precisa ser estreito: um proxy aberto
 * transforma o servidor do portal em intermediário para qualquer endereço que
 * ele alcance — a rede interna inclusive.
 *
 * **Os destinos permitidos vêm da especificação**, não do pedido. A lista é
 * montada a cada chamada a partir de `src/schemas/*.yaml`, que é arquivo
 * versionado: liberar um destino novo passa por edição e revisão, não por um
 * parâmetro.
 *
 * O que nunca acontece aqui: registrar credencial. Os cabeçalhos vão redigidos
 * para o log, e o corpo da resposta não é logado.
 */

const SCHEMAS_ROOT = path.resolve(process.cwd(), 'src/schemas');

/** Limite do corpo devolvido: o Explorer mostra respostas, não faz download. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Servidores declarados em todas as especificações OpenAPI do repositório. */
async function declaredServers(): Promise<string[]> {
	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return [];
	}

	const servers: string[] = [];
	for (const file of files) {
		try {
			const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
			if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;
			servers.push(...parseOpenApi(raw).servers);
		} catch {
			// Especificação inválida não deve derrubar o proxy inteiro.
		}
	}

	return servers;
}

export const POST: APIRoute = async ({ request, url }) => {
	let body: {
		url?: string;
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	};

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, 400);
	body = parsed.value;

	const target = String(body.url ?? '');
	const method = String(body.method ?? 'GET').toUpperCase();

	const servers = await declaredServers();
	const decision = checkTarget(target, {
		allowed: allowedOrigins(servers),
		selfOrigin: url.origin,
		relativeServers: servers.filter((server) => server.startsWith('/')),
	});

	if (!decision.allowed) {
		// 403 e não 400: o pedido é bem formado, e a recusa é de política.
		return json({ error: decision.reason ?? 'Destino não permitido.' }, 403);
	}

	const headers = sanitizeHeaders(body.headers ?? {});
	const started = Date.now();

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

		const response = await fetch(decision.url!, {
			method,
			headers,
			body: ['GET', 'HEAD'].includes(method) ? undefined : body.body,
			signal: controller.signal,
			// Um 302 para outro host escaparia da lista de permitidos; o redirecionamento
			// é devolvido como resposta, e quem quiser segui-lo faz outro pedido.
			redirect: 'manual',
		});

		clearTimeout(timer);

		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, name) => {
			responseHeaders[name] = value;
		});

		const buffer = await response.arrayBuffer();
		const truncated = buffer.byteLength > MAX_RESPONSE_BYTES;
		const text = new TextDecoder().decode(
			truncated ? buffer.slice(0, MAX_RESPONSE_BYTES) : buffer
		);

		// O log traz o essencial e nada de credencial nem de corpo.
		console.info(
			JSON.stringify({
				event: 'explorer_request',
				method,
				origin: new URL(decision.url!).origin,
				status: response.status,
				durationMs: Date.now() - started,
				headers: redactHeaders(headers),
			})
		);

		return json({
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders,
			body: text,
			truncated,
			durationMs: Date.now() - started,
			size: buffer.byteLength,
		});
	} catch (error) {
		const aborted = error instanceof Error && error.name === 'AbortError';
		return json(
			{
				error: aborted
					? `A API não respondeu em ${TIMEOUT_MS / 1000}s.`
					: // A mensagem do fetch é técnica, mas é a real; inventar uma
						// explicação sobre a causa seria adivinhação (§10).
						error instanceof Error
						? error.message
						: 'Falha ao chamar a API.',
			},
			502
		);
	}
};
