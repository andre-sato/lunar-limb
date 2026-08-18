import type { APIRoute } from 'astro';
import { branchDiff } from '../../../../lib/git/diff';
import { detectDefaultBranch, currentBranch } from '../../../../lib/git/workflow';
import {
	changedPaths,
	composePullRequestBody,
	contentImpact,
	createPullRequest,
	getRemote,
	providerToken,
} from '../../../../lib/git/pull-request';
import { lintDocument } from '../../../../lib/linter/lint';
import { loadConfig } from '../../../../lib/linter/config';
import { getGlossaryIndex } from '../../../../lib/glossary/loader';
import { setGlossaryIndex } from '../../../../lib/linter/rules/glossary';
import { getContentFs } from '../../../../lib/editor/content-fs';
import { recordAudit } from '../../../../lib/auth/audit';

export const prerender = false;

/**
 * Revisão da branch: diff, portão de qualidade e criação do pull request
 * (§3.3, §3.4, §3.6, §4).
 *
 * O `GET` responde "o que mudou e está pronto?"; o `POST` cria o pull request.
 * Separados porque a primeira pergunta é feita várias vezes enquanto se escreve,
 * e a segunda uma vez só, no fim.
 */

const DOCS_PREFIX = 'src/content/docs/';
const SNIPPETS_PREFIX = 'src/content/snippets/';

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Roda o linter nos arquivos de conteúdo alterados (§3.4).
 *
 * Só o conteúdo: um PR que mexe em `astro.config.mjs` não tem nota de
 * documentação, e inventar uma seria pior que não ter.
 */
async function runGate(paths: readonly string[]) {
	const content = paths.filter(
		(file) => (file.startsWith(DOCS_PREFIX) || file.startsWith(SNIPPETS_PREFIX)) && /\.mdx?$/.test(file)
	);

	if (content.length === 0) {
		return { score: null, passed: true, files: [], findings: 0 };
	}

	const config = await loadConfig('default');
	setGlossaryIndex(await getGlossaryIndex());

	const docs = getContentFs('docs');
	const snippets = getContentFs('snippets');

	const files: Array<{ path: string; score: number; passed: boolean; findings: number }> = [];

	for (const file of content) {
		const isDoc = file.startsWith(DOCS_PREFIX);
		const relative = file.slice((isDoc ? DOCS_PREFIX : SNIPPETS_PREFIX).length);

		try {
			const document = await (isDoc ? docs : snippets).readDocument(relative);
			const result = await lintDocument(document.content, { path: relative, config });
			files.push({
				path: file,
				score: result.score,
				// `warning` passa: o portão reprova só o que o linter reprova.
				passed: result.gate !== 'fail',
				findings: result.findings.length,
			});
		} catch {
			// Arquivo apagado nesta branch: não há o que analisar.
		}
	}

	if (files.length === 0) return { score: null, passed: true, files: [], findings: 0 };

	// A nota do conjunto é a **menor** das páginas, não a média: uma página ruim
	// no meio de dez boas continua sendo uma página ruim indo para revisão.
	const score = Math.min(...files.map((file) => file.score));

	return {
		score,
		passed: files.every((file) => file.passed),
		files,
		findings: files.reduce((total, file) => total + file.findings, 0),
	};
}

export const GET: APIRoute = async ({ url }) => {
	try {
		const base = url.searchParams.get('base') || (await detectDefaultBranch());
		const head = await currentBranch();

		const [diff, paths, remote] = await Promise.all([branchDiff(base), changedPaths(base), getRemote()]);
		const [gate, impact] = await Promise.all([runGate(paths), contentImpact(paths)]);

		return json({
			base,
			head,
			diff,
			gate,
			impact,
			remote: remote ? { url: remote.url, owner: remote.owner, repo: remote.repo } : null,
			// A interface precisa saber se o botão cria o PR ou abre o provedor.
			canCreatePullRequest: Boolean(remote && providerToken()),
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Falha ao comparar.' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const title = String(body?.title ?? '').trim();
		if (title === '') return json({ error: 'O título é obrigatório.' }, 400);

		const base = String(body?.base ?? '') || (await detectDefaultBranch());
		const head = String(body?.head ?? '') || (await currentBranch());

		if (base === head) {
			return json({ error: 'A branch de origem e a de destino são a mesma.' }, 400);
		}

		const paths = await changedPaths(base);
		if (paths.length === 0) {
			return json({ error: 'Não há alterações entre as duas branches.' }, 400);
		}

		const [gate, impact] = await Promise.all([runGate(paths), contentImpact(paths)]);

		const input = {
			title,
			description: String(body?.description ?? ''),
			base,
			head,
			score: gate.score ?? undefined,
			gatePassed: gate.passed,
			changedFiles: paths,
			impact,
		};

		const result = await createPullRequest(input);

		await recordAudit({
			actorId: locals.user?.id ?? 'anonymous',
			action: 'PULL_REQUEST_PREPARED',
			metadata: {
				base,
				head,
				created: result.created,
				files: paths.length,
				score: gate.score ?? null,
			},
		});

		return json({ ...result, gate, impact, body: composePullRequestBody(input) });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Falha ao criar o pull request.' }, 500);
	}
};
