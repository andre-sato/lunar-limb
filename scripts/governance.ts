/**
 * CLI de Documentation Governance (P3.1 — § CLI).
 *
 *   npm run governance -- status
 *   npm run governance -- owners
 *   npm run governance -- overdue
 *   npm run governance -- audit
 *
 * Códigos de saída: 0 ok · 1 política violada · 2 uso inválido · 3 erro.
 *
 * Nenhum comando escreve. Marcar uma página como revisada é afirmação de uma
 * pessoa e vive no frontmatter, versionado pelo Git — um registro paralelo em
 * `data/` divergiria do arquivo no primeiro `git checkout`.
 */

import { governance } from '../src/lib/governance/service';
import { listAudit } from '../src/lib/auth/audit';
import { APPROVAL_TRIGGER_LABEL, REVIEW_STATE_LABEL, type ReviewState } from '../src/lib/governance/types';

const COLORS = {
	reset: '[0m',
	dim: '[2m',
	red: '[31m',
	yellow: '[33m',
	green: '[32m',
	bold: '[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(text: string, color: keyof typeof COLORS): string {
	return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function bar(percentage: number | null, width = 20): string {
	if (percentage === null) return paint('—'.repeat(width), 'dim');
	const filled = Math.round((percentage / 100) * width);
	const color = percentage >= 95 ? 'green' : percentage >= 80 ? 'yellow' : 'red';
	return paint('█'.repeat(filled), color) + paint('░'.repeat(width - filled), 'dim');
}

function line(label: string, percentage: number | null, detail: string): void {
	const value = percentage === null ? ' — ' : `${String(percentage).padStart(3)}%`;
	console.log(`  ${label.padEnd(22)} ${bar(percentage)} ${value}  ${paint(detail, 'dim')}`);
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv.find((argument) => !argument.startsWith('--')) ?? 'status';
	const json = argv.includes('--json');

	if (command === 'owners') {
		const owners = await governance.owners();
		if (json) {
			console.log(JSON.stringify(owners, null, 2));
			return 0;
		}

		console.log('');
		console.log(paint('Donos da documentação', 'bold'));
		console.log('');

		for (const entry of owners) {
			const orphan = entry.owner === 'sem dono';
			console.log(
				`  ${orphan ? paint('✗', 'red') : paint('●', 'green')} ${entry.label.padEnd(24)} ${entry.pages.length} página(s)`
			);
			if (orphan) for (const page of entry.pages.slice(0, 20)) console.log(paint(`      ${page}`, 'dim'));
		}

		console.log('');
		return 0;
	}

	if (command === 'overdue') {
		const overdue = await governance.overdue();
		if (json) {
			console.log(JSON.stringify(overdue, null, 2));
			return overdue.length > 0 ? 1 : 0;
		}

		console.log('');
		const never = overdue.filter((status) => status.neverReviewed).length;
		console.log(paint(`${overdue.length} página(s) pendentes de revisão`, 'bold'));
		console.log(paint(`${overdue.length - never} vencida(s) · ${never} nunca revisada(s)`, 'dim'));
		console.log('');

		for (const status of overdue) {
			const mark = status.slaBreached ? paint('✗', 'red') : paint('⚠', 'yellow');
			const detail = status.neverReviewed
				? 'nunca revisada, e a regra exige revisão periódica'
				: `venceu há ${-(status.daysUntilDue ?? 0)} dia(s)`;

			console.log(`  ${mark} ${status.path}`);
			console.log(
				paint(
					`      ${detail} · severidade ${status.severity} · SLA ${status.slaDays}d${status.slaBreached ? ' (estourado)' : ''}`,
					'dim'
				)
			);
		}

		if (overdue.length === 0) console.log(paint('  Nenhuma. Toda página sob regime de revisão está em dia.', 'dim'));

		console.log('');
		return overdue.length > 0 ? 1 : 0;
	}

	if (command === 'audit') {
		const limitIndex = argv.indexOf('--limit');
		const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) || 30 : 30;
		const events = await listAudit({ limit });

		if (json) {
			console.log(JSON.stringify(events, null, 2));
			return 0;
		}

		console.log('');
		console.log(paint(`Trilha de auditoria — ${events.length} evento(s) mais recentes`, 'bold'));
		console.log(
			paint('O log registra o tipo do evento e quem o causou, nunca o conteúdo da documentação nem de perguntas.', 'dim')
		);
		console.log('');

		for (const event of events) {
			const when = event.timestamp.slice(0, 19).replace('T', ' ');
			console.log(`  ${paint(when, 'dim')}  ${event.action.padEnd(28)} ${event.actorId}`);
			if (event.targetId) console.log(paint(`      ${event.targetId}`, 'dim'));
		}

		if (events.length === 0) console.log(paint('  Nenhum evento registrado ainda.', 'dim'));

		console.log('');
		return 0;
	}

	if (command !== 'status') {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: status, owners, overdue, audit.');
		return 2;
	}

	const snapshot = await governance.status();
	if (json) {
		console.log(JSON.stringify(snapshot, null, 2));
		return snapshot.config.failOnExpired && snapshot.compliance.expiredReviews > 0 ? 1 : 0;
	}

	const { compliance } = snapshot;

	console.log('');
	console.log(paint('Governança da documentação', 'bold'));
	console.log('');

	line('Cobertura de dono', compliance.ownership.percentage, `${compliance.ownership.covered}/${compliance.ownership.total}`);
	line('Revisões em dia', compliance.review.percentage, `${compliance.review.compliant}/${compliance.review.total}`);
	line('Aprovações designadas', compliance.approval.percentage, `${compliance.approval.compliant}/${compliance.approval.total}`);

	console.log('');
	console.log(`  Revisões vencidas       ${compliance.expiredReviews > 0 ? paint(String(compliance.expiredReviews), 'yellow') : '0'}`);
	console.log(`  Nunca revisadas         ${compliance.neverReviewed > 0 ? paint(String(compliance.neverReviewed), 'yellow') : '0'}`);
	console.log(`  SLA estourado           ${compliance.slaBreaches > 0 ? paint(String(compliance.slaBreaches), 'red') : '0'}`);
	console.log(
		`  Páginas sem dono        ${compliance.unownedPages.length > 0 ? paint(String(compliance.unownedPages.length), 'red') : '0'}`
	);

	if (compliance.unownedPages.length > 0) {
		console.log('');
		for (const page of compliance.unownedPages.slice(0, 15)) console.log(paint(`      ${page}`, 'dim'));
		if (compliance.unownedPages.length > 15) {
			console.log(paint(`      … e mais ${compliance.unownedPages.length - 15}`, 'dim'));
		}
	}

	const byState = new Map<ReviewState, number>();
	for (const status of snapshot.statuses) byState.set(status.state, (byState.get(status.state) ?? 0) + 1);

	console.log('');
	console.log(paint('  Estado das páginas', 'bold'));
	for (const [state, count] of [...byState.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`    ${REVIEW_STATE_LABEL[state].padEnd(20)} ${count}`);
	}

	const pending = snapshot.approvals.filter((entry) => !entry.satisfied);
	if (pending.length > 0) {
		console.log('');
		console.log(paint(`  ${pending.length} página(s) exigem aprovação e não têm aprovador designado`, 'bold'));
		for (const entry of pending.slice(0, 10)) {
			console.log(`    ${paint('✗', 'red')} ${entry.path}`);
			console.log(paint(`        ${entry.triggers.map((trigger) => APPROVAL_TRIGGER_LABEL[trigger]).join(', ')}`, 'dim'));
		}
	}

	console.log('');
	console.log(paint('  "Revisada" é o que alguém declarou no frontmatter — nunca a data do último commit.', 'dim'));
	console.log('');

	return snapshot.config.failOnExpired && compliance.expiredReviews > 0 ? 1 : 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao montar o relatório de governança:', error);
		process.exitCode = 3;
	});
