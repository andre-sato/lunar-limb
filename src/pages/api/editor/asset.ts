import type { APIRoute } from 'astro';
import { AssetFsError, readAsset } from '../../../lib/editor/asset-fs';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const assetPath = url.searchParams.get('path');
	if (!assetPath) {
		return new Response('Parâmetro "path" é obrigatório.', { status: 400 });
	}

	try {
		const { buffer, mime } = await readAsset(assetPath);
		// `Buffer` funciona em runtime, mas não satisfaz o tipo `BodyInit`
		// (que exige uma view sobre `ArrayBuffer`, não `ArrayBufferLike`).
		// A view abaixo é a mesma memória, sem cópia.
		const body = new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength);
		return new Response(body, {
			status: 200,
			headers: {
				'Content-Type': mime,
				'Cache-Control': 'no-store',
			},
		});
	} catch (err) {
		const status = err instanceof AssetFsError ? err.status : 500;
		const message = err instanceof Error ? err.message : 'Erro desconhecido.';
		return new Response(message, { status });
	}
};
