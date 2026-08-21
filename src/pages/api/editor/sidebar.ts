import type { APIRoute } from 'astro';
import { recordAudit } from '../../../lib/auth/audit';
import {
	availableSlugs,
	hiddenSlugs,
	loadSidebar,
	normalizeSidebar,
	saveSidebar,
	validateSidebar,
} from '../../../lib/editor/sidebar';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});
}

/** Título de cada página, para a tela mostrar nomes e não slugs. */
async function titles(slugs: readonly string[]): Promise<Record<string, string>> {
	const root = path.resolve(process.cwd(), 'src/content/docs');
	const found: Record<string, string> = {};

	for (const slug of slugs) {
		for (const extension of ['.mdx', '.md']) {
			const raw = await readFile(path.join(root, `${slug}${extension}`), 'utf-8').catch(() => null);
			if (raw === null) continue;
			found[slug] = raw.match(/^title:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim() ?? slug;
			break;
		}
	}

	return found;
}

/**
 * Organização da navegação (issue #11, opção A).
 *
 * `GET` devolve os grupos, os slugs disponíveis e os títulos. `PUT` grava, e só
 * grava o que passa na validação: um slug inexistente derruba o build inteiro da
 * Starlight, então recusar aqui é a diferença entre um formulário que reclama e
 * um portal fora do ar.
 *
 * O que esta rota **não** faz é mover arquivo. Reordenar dados não muda URL
 * nenhuma; mover um arquivo muda todas as que ele tinha, e quebra os links
 * internos, os externos e as referências de conteúdo reutilizável junto.
 */
export const GET: APIRoute = async () => {
	const [config, available] = await Promise.all([loadSidebar(), availableSlugs()]);
	// Sem isto, a página que declara `visible: false` é acusada de órfã — e a
	// validação recusaria toda gravação por causa de algo que está certo.
	const hidden = await hiddenSlugs(available);

	return json({
		config,
		available,
		hidden: [...hidden],
		titles: await titles(available),
		validation: validateSidebar(config, available, hidden),
	});
};

export const PUT: APIRoute = async ({ request, locals }) => {
	let config;
	try {
		config = normalizeSidebar(await request.json());
	} catch (error) {
		return json({ error: 'invalid_body', message: error instanceof Error ? error.message : String(error) }, 400);
	}

	const available = await availableSlugs();
	const validation = validateSidebar(config, available, await hiddenSlugs(available));

	if (!validation.valid) {
		return json({ error: 'invalid_sidebar', validation }, 422);
	}

	await saveSidebar(config);

	await recordAudit({
		actorId: locals.authUser?.id ?? 'desconhecido',
		action: 'DOCUMENT_UPDATED',
		targetId: 'src/config/sidebar.json',
		metadata: { groups: config.guides.length, items: config.guides.reduce((sum, g) => sum + g.items.length, 0) },
	});

	return json({
		config,
		validation,
		// A Starlight monta a barra no build. Salvar não muda o que já está
		// servido, e dizer isso é o que impede alguém achar que a alteração não
		// funcionou e salvar de novo.
		notice: 'Salvo. A navegação publicada muda no próximo build; no servidor de desenvolvimento, ao reiniciá-lo.',
	});
};
