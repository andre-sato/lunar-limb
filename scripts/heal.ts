/**
 * CLI de Self-Healing Documentation (P3.6 — §27).
 *
 *   npm run heal -- status
 *   npm run heal -- detect
 *   npm run heal -- diagnose <issue>
 *   npm run heal -- draft <issue>
 *   npm run heal -- history
 *
 * Códigos de saída: 0 ok · 2 uso inválido · 3 erro.
 *
 * `draft` é o único comando que gera conteúdo, e ele escreve **no workspace
 * isolado** do Agent Orchestrator. Nada aqui altera a documentação publicada,
 * abre pull request sozinho ou faz merge.
 */

import { selfHealing } from '../src/lib/heal/service';
import { AUTONOMY_LABEL, ISSUE_LABEL } from '../src/lib/heal/types';

const COLORS = {
	reset: '[0m',
	dim: '[2m',
	red: '[31m',
	yellow: '[33m',
	green: '[32m',
	bold: '[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(text: string, color: keyof typeof COLORS): string {
	return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

const SEVERITY_COLOR = { low: 'dim', medium: 'yellow', high: 'red', critical: 'red' } as const;

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');

	const positional = argv.filter((argument) => !argument.startsWith('--'));
	const command = positional[0] ?? 'status';
	const target = positional[1];

	if (command === 'detect') {
		const issues = await selfHealing.detect();

		if (json) {
			console.log(JSON.stringify(issues, null, 2));
			return 0;
		}

		console.log('');
		console.log(paint(`${issues.length} problema(s) detectado(s)`, 'bold'));
		console.log(paint('Nenhum sinal é gerado aqui: todos vêm de camadas que já verificam o repositório.', 'dim'));
		console.log('');

		for (const issue of issues) {
			console.log(
				`  ${paint('●', SEVERITY_COLOR[issue.severity])} ${ISSUE_LABEL[issue.type].padEnd(34)} ${paint(`${Math.round(issue.confidence * 100)}%`, 'dim')}`
			);
			console.log(`      ${issue.summary}`);
			console.log(paint(`      ${issue.id}`, 'dim'));
		}

		if (issues.length === 0) console.log(paint('  Nenhum. As camadas de verificação não apontaram nada.', 'dim'));

		console.log('');
		return 0;
	}

	if (command === 'diagnose') {
		if (!target) {
			console.error('Informe o problema: npm run heal -- diagnose <id>');
			return 2;
		}

		const diagnosis = await selfHealing.diagnose(target);

		if (!diagnosis) {
			console.error(`Nenhum problema com id "${target}". Rode \`npm run heal -- detect\` primeiro.`);
			return 2;
		}

		if (json) {
			console.log(JSON.stringify(diagnosis, null, 2));
			return 0;
		}

		console.log('');
		console.log(`${paint('Diagnóstico', 'bold')}  ${paint(target, 'dim')}`);
		console.log('');
		console.log(`  Causa provável   ${diagnosis.rootCause}`);
		console.log(`  Confiança        ${Math.round(diagnosis.confidence * 100)}%`);
		console.log('');

		for (const entry of diagnosis.evidence) {
			console.log(`  ${paint('·', 'dim')} ${entry.fact}`);
			console.log(paint(`      ${entry.source}  ·  ${Math.round(entry.confidence * 100)}%`, 'dim'));
		}

		if (diagnosis.conflict) {
			console.log('');
			console.log(paint('  Conflito entre fontes autoritativas', 'red'));
			for (const claim of diagnosis.conflict.claims) {
				console.log(paint(`    ${claim.source}: ${claim.claim}  (${claim.reference})`, 'dim'));
			}
			console.log(paint(`  ${diagnosis.conflict.reason}`, 'dim'));
		}

		if (diagnosis.unhealable) {
			console.log('');
			console.log(paint(`  ❌ Não corrigível automaticamente: ${diagnosis.reason}`, 'yellow'));
		}

		console.log('');
		return 0;
	}

	if (command === 'draft') {
		if (!target) {
			console.error('Informe o problema: npm run heal -- draft <id>');
			return 2;
		}

		const candidate = await selfHealing.propose(target, 'cli');

		if (!candidate) {
			const [record] = await selfHealing.getHistory(target);
			const last = record?.timeline.at(-1);

			console.log('');
			console.log(paint('  Nenhuma proposta gerada.', 'yellow'));
			if (last) console.log(paint(`  ${last.event}: ${last.detail ?? ''}`, 'dim'));
			console.log('');
			return 0;
		}

		if (json) {
			console.log(JSON.stringify(candidate, null, 2));
			return 0;
		}

		console.log('');
		console.log(
			`${paint('Proposta', 'bold')}  risco ${paint(candidate.risk, SEVERITY_COLOR[candidate.risk])}  ${paint(`confiança ${Math.round(candidate.confidence * 100)}%`, 'dim')}`
		);
		console.log('');

		for (const change of candidate.changes) {
			console.log(`  ${change.path}  ${paint(`+${change.added} −${change.removed}`, 'dim')}`);
			for (const line of change.diff.split('\n').slice(0, 24)) {
				const color = line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : 'dim';
				console.log(paint(`    ${line}`, color));
			}
		}

		console.log('');
		console.log(paint('  Validações', 'bold'));
		for (const validation of candidate.validations) {
			const mark = validation.passed === null ? paint('·', 'dim') : validation.passed ? paint('✓', 'green') : paint('✗', 'red');
			console.log(`    ${mark} ${validation.name.padEnd(12)} ${paint(validation.detail, 'dim')}`);
		}

		console.log('');
		console.log(
			candidate.validated
				? paint('  ✓ Todas as validações aplicáveis passaram.', 'green')
				: paint('  ⚠ Validação incompleta: uma proposta não validada não vira pull request.', 'yellow')
		);
		console.log('');
		console.log(paint('  O texto está no workspace isolado. Aprovação humana em Settings → Agents.', 'dim'));
		console.log('');

		return 0;
	}

	if (command === 'history') {
		const records = await selfHealing.getHistory(target);

		if (json) {
			console.log(JSON.stringify(records, null, 2));
			return 0;
		}

		console.log('');
		console.log(paint(`${records.length} registro(s)`, 'bold'));
		console.log('');

		for (const record of records.slice(-20)) {
			console.log(`  ${record.status.padEnd(12)} ${record.issueId}`);
			for (const entry of record.timeline) {
				console.log(paint(`      ${entry.at.slice(0, 19).replace('T', ' ')}  ${entry.event}${entry.detail ? `: ${entry.detail}` : ''}`, 'dim'));
			}
		}

		console.log('');
		return 0;
	}

	if (command !== 'status') {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: status, detect, diagnose <id>, draft <id>, history.');
		return 2;
	}

	const [summary, policy] = await Promise.all([selfHealing.summary(), selfHealing.policy()]);

	if (json) {
		console.log(JSON.stringify({ summary, policy }, null, 2));
		return 0;
	}

	console.log('');
	console.log(`${paint('Self-Healing', 'bold')}  ${paint(`nível ${policy.autonomy} — ${AUTONOMY_LABEL[policy.autonomy]}`, 'dim')}`);
	console.log('');
	console.log(`  Detectados        ${summary.detected}`);
	console.log(`  Diagnosticados    ${summary.candidates}`);
	console.log(`  Com proposta      ${summary.drafted}`);
	console.log(`  Pull requests     ${summary.pullRequests}`);
	console.log(`  Resolvidos        ${summary.resolved}`);
	console.log(`  Falharam          ${summary.failed}`);
	console.log(
		`  Taxa de sucesso   ${summary.successRate === null ? paint('— nada concluído ainda', 'dim') : `${summary.successRate}%`}`
	);

	if (Object.keys(summary.byType).length > 0) {
		console.log('');
		console.log(paint('  Por tipo', 'bold'));
		for (const [type, count] of Object.entries(summary.byType).sort((a, b) => b[1] - a[1])) {
			console.log(`    ${(ISSUE_LABEL[type as keyof typeof ISSUE_LABEL] ?? type).padEnd(34)} ${count}`);
		}
	}

	console.log('');
	console.log(paint('  Merge automático está desligado. Nada é publicado sem aprovação humana.', 'dim'));
	console.log('');

	return 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha no ciclo de self-healing:', error);
		process.exitCode = 3;
	});
