/**
 * `DocumentationHealthService` (§21).
 *
 * A interface da spec sobre a camada que já existe. Ela não calcula nada: cada
 * método delega ao coletor, ao histórico ou às funções puras — o que mantém o
 * critério de aceite que proíbe duplicar a lógica do Linter, dos Testes ou do
 * Digital Twin.
 *
 * `createSnapshot` é o único método que **escreve**, e escreve a única coisa que
 * não se deriva: como o portal estava num instante.
 */

import { collectHealth, type ObservabilityReport } from './collect';
import {
	detectRegression,
	listSnapshots,
	saveSnapshot,
	snapshotNearest,
	withinDays,
	type HealthRegression,
	type HealthSnapshot,
} from './snapshots';
import type { PageHealth } from './budget';
import type { SloEvaluation } from './types';

export interface SloReport {
	evaluations: SloEvaluation[];
	budgets: ObservabilityReport['budgets'];
	score: number;
	minimum: number;
	passed: boolean;
}

export interface DocumentationHealthService {
	getOverview(): Promise<ObservabilityReport>;
	getPageHealth(pageId: string): Promise<PageHealth | undefined>;
	getHistory(range: { days: number }): Promise<HealthSnapshot[]>;
	evaluateSLO(): Promise<SloReport>;
	getRegressions(windows?: readonly number[]): Promise<HealthRegression[]>;
	createSnapshot(): Promise<HealthSnapshot>;
}

export const documentationHealth: DocumentationHealthService = {
	async getOverview() {
		return collectHealth();
	},

	async getPageHealth(pageId) {
		const report = await collectHealth();
		return report.pages.find((page) => page.path === pageId || page.path.replace(/\.mdx?$/, '') === pageId);
	},

	async getHistory(range) {
		return withinDays(await listSnapshots(), range.days);
	},

	async evaluateSLO() {
		const report = await collectHealth();

		return {
			evaluations: report.slo,
			budgets: report.budgets,
			score: report.overall,
			minimum: report.minimumHealthScore,
			// Violação de SLO **ou** score abaixo do mínimo reprovam; risco não.
			// Reprovar por risco levaria a equipe a afrouxar os alvos até tudo ficar
			// verde, que é o oposto do que um SLO serve para fazer.
			passed: report.overall >= report.minimumHealthScore && report.sloStatus !== 'breached',
		};
	},

	/**
	 * Regressões em várias janelas.
	 *
	 * Uma janela só engana nos dois sentidos: comparar com ontem esconde uma queda
	 * lenta de um mês, e comparar com o mês passado esconde a queda de ontem.
	 */
	async getRegressions(windows = [7, 30, 90]) {
		const [report, snapshots] = await Promise.all([collectHealth(), listSnapshots()]);
		if (snapshots.length === 0) return [];

		const current: HealthSnapshot = {
			at: new Date().toISOString(),
			score: report.overall,
			dimensions: Object.fromEntries(
				report.dimensions.filter((dimension) => dimension.measured).map((dimension) => [dimension.dimension, dimension.value])
			),
			reliability: {
				brokenLinks: report.reliability.brokenLinks,
				failedTests: report.reliability.failedTests,
				brokenContracts: report.reliability.brokenContracts,
				invalidPages: report.reliability.invalidPages,
			},
		};

		return windows
			.map((days) => snapshotNearest(snapshots, days))
			.filter((snapshot): snapshot is HealthSnapshot => snapshot !== undefined)
			.map((snapshot) => detectRegression(snapshot, current))
			// Só as quedas: a lista existe para explicar piora.
			.filter((regression) => regression.delta < 0);
	},

	async createSnapshot() {
		const report = await collectHealth({ snapshot: false });

		const snapshot: HealthSnapshot = {
			at: new Date().toISOString(),
			score: report.overall,
			dimensions: Object.fromEntries(
				report.dimensions.filter((dimension) => dimension.measured).map((dimension) => [dimension.dimension, dimension.value])
			),
			reliability: {
				brokenLinks: report.reliability.brokenLinks,
				failedTests: report.reliability.failedTests,
				brokenContracts: report.reliability.brokenContracts,
				invalidPages: report.reliability.invalidPages,
			},
		};

		await saveSnapshot(snapshot);
		return snapshot;
	},
};
