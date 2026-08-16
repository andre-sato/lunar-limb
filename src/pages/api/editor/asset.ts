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
		return new Response(buffer, {
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
