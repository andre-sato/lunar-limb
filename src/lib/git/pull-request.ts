/**
 * Pull request: portão de qualidade e criação (§3.4, §3.6, §4).
 *
 * Duas metades bem diferentes.
 *
 * **O portão** é nosso e roda local: linter, quality score, impacto no Content
 * Graph. Ele responde "esta alteração está pronta para revisão?" antes de
 * qualquer coisa sair da máquina.
 *
 * **A criação** é do provedor. O PR vive no GitHub, e é lá que a revisão, a
 * aprovação e o merge acontecem — reimplementar isso aqui seria construir um
 * GitHub pior dentro do editor, e ainda por cima desconectado do que a equipe
 * já usa para revisar código.
 *
 * Sem credencial configurada, esta camada **não falha**: ela devolve a URL de
 * comparação do provedor, com título e corpo prontos. O trabalho de preparação
 * não se perde por falta de token.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { changedPaths } from './diff';
import { SEVERITY_MARK, REVIEW_SCOPE_LABEL, type ImpactReport } from '../impact/types';

const run = promisify(execFile);

const DOCS_PREFIX = 'src/content/docs/';
const SNIPPETS_PREFIX = 'src/content/snippets/';

export interface RemoteInfo {
	/** `https://github.com/dono/repo` — sem `.git` e sem credencial embutida. */
	url: string;
	owner: string;
	repo: string;
	host: string;
}

/**
 * Lê o remoto `origin` e o normaliza.
 *
 * Aceita as duas formas que o Git usa (`https://` e `git@host:dono/repo`), e
 * descarta qualquer credencial que esteja embutida na URL — ela não deve chegar
 * à interface nem a um log.
 */
export function parseRemote(raw: string): RemoteInfo | null {
	const url = raw.trim();
	if (url === '') return null;

	const ssh = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
	const https = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
	const match = ssh ?? https;
	if (!match) return null;

	const host = match[1];
	const segments = match[2].split('/').filter(Boolean);
	if (segments.length < 2) return null;

	const owner = segments[segments.length - 2];
	const repo = segments[segments.length - 1];

	return { url: `https://${host}/${owner}/${repo}`, owner, repo, host };
}

export async function getRemote(): Promise<RemoteInfo | null> {
	try {
		const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd() });
		return parseRemote(stdout);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Corpo do pull request
// ---------------------------------------------------------------------------

export interface PullRequestInput {
	title: string;
	description: string;
	base: string;
	head: string;
	score?: number;
	gatePassed?: boolean;
	changedFiles: readonly string[];
	/**
	 * Relatório do Impact Engine. Substituiu a contagem de um salto que existia
	 * aqui: ela dizia "nenhuma página afetada" quando o bloco alterado era usado
	 * por outro bloco, e essa resposta era confiante e errada.
	 */
	impact?: ImpactReport;
	/** Resumo da Documentation Test Suite, quando ela rodou. */
	tests?: { total: number; passed: number; failed: number; skipped: number };
	/** Cobertura documental do Digital Twin. */
	coverage?: { endpoints: number; minimum: number; passed: boolean };
	/** Contratos de documentação quebrados ou com aviso. */
	contracts?: { broken: number; warning: number; pages: string[] };
	/** Saúde da documentação, antes e depois. */
	health?: { score: number; previous: number | null; delta: number | null; newIssues: string[] };
	/**
	 * Documentation-to-Code Loop: entidades do produto que a branch alterou e não
	 * têm página vinculada. É a pergunta que os outros portões não fazem — eles
	 * verificam se o que está escrito está certo, não se alguém escreveu.
	 */
	codeLoop?: { coverage: number; blocked: boolean; entities: number; missing: string[]; stalePages: string[] };
	/**
	 * Impacto no SDK gerado. Ele merece seção própria porque é o único artefato
	 * daqui que vive **fora** deste repositório: uma ruptura quebra o build de
	 * quem instalou o pacote, e isso não aparece em nenhum diff desta branch.
	 */
	sdk?: { breaking: number; additive: number; regenerate: string[] };
}

/**
 * Monta o corpo do PR.
 *
 * O que entra aqui é o que a pessoa revisora precisa saber **antes** de abrir os
 * arquivos: a nota do linter, quantas páginas mudam sem aparecer no diff, e a
 * lista do que foi tocado.
 */
export function composePullRequestBody(input: PullRequestInput): string {
	const parts: string[] = [];

	if (input.description.trim() !== '') {
		parts.push(input.description.trim(), '');
	}

	if (typeof input.score === 'number') {
		const verdict = input.gatePassed === false ? '⚠️ abaixo do mínimo' : '✅';
		parts.push(`**Quality Score:** ${input.score.toFixed(1)}/10 ${verdict}`, '');
	}

	if (input.tests && input.tests.total > 0) {
		const { passed, failed, skipped } = input.tests;
		// Falha de teste é afirmação sobre comportamento — link quebrado, exemplo
		// que não bate com o contrato. Vem antes da lista de arquivos porque é o
		// que decide se vale abrir os arquivos.
		parts.push(
			`**Testes de documentação:** ${failed === 0 ? '✅' : '❌'} ${passed} passaram, ${failed} falharam, ${skipped} pulados`,
			''
		);
	}

	if (input.health) {
		const { score, previous, delta, newIssues } = input.health;

		if (previous === null || delta === null) {
			// Sem snapshot anterior não há comparação. Dizer isso é melhor que
			// mostrar "-0", que uma equipe aprende a ignorar.
			parts.push(`**Documentation Health:** ${score}/100 _(sem medição anterior para comparar)_`, '');
		} else {
			const mark = delta < 0 ? '🔴' : delta > 0 ? '🟢' : '⚪';
			parts.push(`**Documentation Health:** ${previous} → ${score} ${mark} ${delta > 0 ? '+' : ''}${delta}`, '');
		}

		if (newIssues.length > 0) {
			parts.push('Defeitos novos: ' + newIssues.join(', '), '');
		}
	}

	if (input.contracts && input.contracts.broken + input.contracts.warning > 0) {
		const { broken, warning, pages } = input.contracts;
		parts.push(
			`**Contratos de documentação:** ${broken > 0 ? '🔴' : '🟡'} ${broken} quebrado(s), ${warning} com aviso`,
			''
		);
		for (const page of [...new Set(pages)]) parts.push(`- \`${page}\``);
		parts.push('');
	}

	if (input.coverage) {
		const { endpoints, minimum, passed } = input.coverage;
		parts.push(
			`**Cobertura documental:** ${passed ? '✅' : '🔴'} ${endpoints}% dos endpoints (mínimo ${minimum}%)`,
			''
		);
	}

	const docs = input.changedFiles.filter((file) => file.startsWith(DOCS_PREFIX));
	const snippets = input.changedFiles.filter((file) => file.startsWith(SNIPPETS_PREFIX));
	const others = input.changedFiles.filter(
		(file) => !file.startsWith(DOCS_PREFIX) && !file.startsWith(SNIPPETS_PREFIX)
	);

	parts.push(`**Arquivos alterados:** ${input.changedFiles.length}`, '');
	for (const [label, files] of [
		['Páginas', docs],
		['Blocos reutilizáveis', snippets],
		['Outros', others],
	] as const) {
		if (files.length === 0) continue;
		parts.push(`_${label}_`);
		for (const file of files) parts.push(`- \`${file}\``);
		parts.push('');
	}

	if (input.impact) parts.push(...impactSection(input.impact));
	if (input.codeLoop && input.codeLoop.entities > 0) parts.push(...codeLoopSection(input.codeLoop));
	if (input.sdk && input.sdk.breaking + input.sdk.additive > 0) parts.push(...sdkSection(input.sdk));

	parts.push('---', '_Preparado pelo editor do portal._');
	return parts.join('\n').trim();
}

/** A parte do corpo que fala do SDK gerado. */
function sdkSection(sdk: NonNullable<PullRequestInput['sdk']>): string[] {
	const parts: string[] = [
		`**SDK:** ${sdk.breaking} mudança(s) incompatível(is) · ${sdk.additive} aditiva(s)`,
		'',
	];

	if (sdk.breaking > 0) {
		parts.push('> Mudança incompatível quebra o build de quem já instalou o pacote.', '');
	}

	if (sdk.regenerate.length > 0) {
		parts.push('_Arquivos a regerar:_');
		for (const file of sdk.regenerate.slice(0, 15)) parts.push(`- \`${file}\``);
		parts.push('', 'Rode `npm run sdk -- generate`.', '');
	}

	return parts;
}

/** A parte do corpo que fala do vínculo com o código (P2.2). */
function codeLoopSection(loop: NonNullable<PullRequestInput['codeLoop']>): string[] {
	const parts: string[] = [
		`**Cobertura documental da mudança:** ${loop.coverage}% · ${loop.entities} entidade(s) do produto alterada(s)`,
		'',
	];

	if (loop.missing.length > 0) {
		parts.push('_Sem página vinculada:_');
		for (const entity of loop.missing.slice(0, 15)) parts.push(`- \`${entity}\``);
		if (loop.missing.length > 15) parts.push(`- … e mais ${loop.missing.length - 15}`);
		parts.push('');
	}

	if (loop.stalePages.length > 0) {
		parts.push('_Página vinculada que não foi atualizada nesta branch:_');
		for (const page of loop.stalePages.slice(0, 15)) parts.push(`- \`${page}\``);
		parts.push('');
	}

	if (loop.blocked) parts.push('> A política do `codeloop.yml` considera esta mudança bloqueada.', '');

	return parts;
}

/**
 * A parte do corpo que fala de impacto (§10, §11).
 *
 * A ordem é deliberada: primeiro o que **quebra**, depois o que muda sem aparecer
 * no diff, e por último o checklist. Quem revisa lê de cima para baixo e para
 * quando entendeu o tamanho do trabalho — então o que muda a decisão vem antes.
 */
function impactSection(impact: ImpactReport): string[] {
	const parts: string[] = [];

	if (impact.api.breaking.length > 0) {
		parts.push(`**Quebra de contrato de API:** ${impact.api.breaking.length}`, '');
		for (const change of impact.api.breaking) parts.push(`- ${SEVERITY_MARK.critical} ${change}`);
		parts.push('');
	}

	if (impact.items.length > 0) {
		const { critical, high, medium, low } = impact.counts;
		parts.push(
			'**Documentation Impact**',
			'',
			[
				critical > 0 ? `${SEVERITY_MARK.critical} ${critical} crítico(s)` : '',
				high > 0 ? `${SEVERITY_MARK.high} ${high} alto(s)` : '',
				medium > 0 ? `${SEVERITY_MARK.medium} ${medium} médio(s)` : '',
				low > 0 ? `${SEVERITY_MARK.low} ${low} baixo(s)` : '',
			]
				.filter(Boolean)
				.join(' · '),
			''
		);

		// Página que muda de conteúdo sem aparecer no diff é o achado que justifica
		// o motor: ninguém a revisaria olhando os arquivos alterados.
		const hidden = impact.items.filter((item) => item.hidden);
		if (hidden.length > 0) {
			parts.push(`${hidden.length} página(s) mudam de conteúdo e **não aparecem no diff**:`, '');
			for (const item of hidden.slice(0, 20)) {
				const path = item.via.length > 2 ? ` _(via ${item.via.length - 2} nível(is))_` : '';
				parts.push(`- ${SEVERITY_MARK[item.severity]} \`${item.node.path}\`${path} — ${item.reason}`);
			}
			if (hidden.length > 20) parts.push(`- … e mais ${hidden.length - 20}`);
			parts.push('');
		}

		parts.push(
			`**Impact Score:** ${impact.score.value}/100 · escopo de revisão: ${REVIEW_SCOPE_LABEL[impact.scope]}`,
			''
		);
	}

	if (impact.checklist.length > 0) {
		parts.push('**Checklist de revisão**', '');
		for (const item of impact.checklist.slice(0, 20)) {
			parts.push(`- [ ] ${SEVERITY_MARK[item.severity]} ${item.label}`);
		}
		if (impact.checklist.length > 20) parts.push(`- [ ] … e mais ${impact.checklist.length - 20} item(ns)`);
		parts.push('');
	}

	return parts;
}

/** URL de comparação do provedor, com título e corpo já preenchidos. */
export function compareUrl(remote: RemoteInfo, input: PullRequestInput): string {
	const parameters = new URLSearchParams({
		quick_pull: '1',
		title: input.title,
		body: composePullRequestBody(input),
	});
	return `${remote.url}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}?${parameters}`;
}

// ---------------------------------------------------------------------------
// Criação pelo provedor
// ---------------------------------------------------------------------------

export interface PullRequestResult {
	created: boolean;
	url: string;
	number?: number;
	/** Explica por que não foi criado, quando `created` é `false`. */
	reason?: string;
}

/** Token do provedor. Vem do ambiente; nunca do repositório nem da interface. */
export function providerToken(): string {
	return (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim();
}

/**
 * Cria o PR no provedor, ou devolve o caminho manual.
 *
 * Falta de token não é erro: é a configuração mais comum de quem acabou de
 * clonar o projeto. A URL de comparação leva ao mesmo lugar com tudo preenchido.
 */
export async function createPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
	const remote = await getRemote();
	if (!remote) {
		return { created: false, url: '', reason: 'Nenhum remoto `origin` configurado.' };
	}

	const token = providerToken();
	if (!token) {
		return {
			created: false,
			url: compareUrl(remote, input),
			reason: 'Sem GITHUB_TOKEN no ambiente: abra o link para criar o pull request.',
		};
	}

	if (remote.host !== 'github.com') {
		return {
			created: false,
			url: compareUrl(remote, input),
			reason: `A criação automática cobre github.com; este remoto é ${remote.host}.`,
		};
	}

	const response = await fetch(`https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			title: input.title,
			body: composePullRequestBody(input),
			base: input.base,
			head: input.head,
		}),
	});

	if (!response.ok) {
		// A mensagem do provedor é mais útil que a nossa, mas o token nunca
		// aparece nela — e não há nada nosso a acrescentar sobre o motivo.
		const detail = await response.text().catch(() => '');
		const message = detail.slice(0, 300) || `HTTP ${response.status}`;
		return { created: false, url: compareUrl(remote, input), reason: `O provedor recusou: ${message}` };
	}

	const created = (await response.json()) as { html_url?: string; number?: number };
	return { created: true, url: created.html_url ?? remote.url, number: created.number };
}

export { changedPaths };
