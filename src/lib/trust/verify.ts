/**
 * Verificação de evidência e frescor (§6, §7, §8).
 *
 * Puro por construção: os resolvedores entram como funções. Isso permite testar
 * cada regra sem repositório e — o que importa mais — deixa explícito que a
 * verificação **não** adivinha nada. Ela pergunta a quem sabe: a especificação
 * OpenAPI sabe se o endpoint existe, o disco sabe se o arquivo e a linha existem,
 * a suíte sabe se o teste existe.
 *
 * O que a verificação **não** faz, e não deve fingir fazer: julgar se a frase é
 * verdadeira. "Chaves expiram em 90 dias" com evidência em `auth/config.ts:42`
 * fica `verified` porque o arquivo e a linha existem — não porque alguém provou os
 * 90 dias. `verified` quer dizer "a evidência confere"; ler como "a frase está
 * certa" é o jeito mais rápido de o selo virar falso conforto.
 */

import type { Claim, EvidenceResult, Provenance, VerificationStatus, VerifiedClaim } from './types';
import { worstStatus } from './types';

export interface Resolvers {
	/** O ponteiro existe na especificação? `undefined` quando ela não foi lida. */
	openapiPointer?: (source: string) => boolean | undefined;
	asyncapiPointer?: (source: string) => boolean | undefined;
	/** O arquivo existe? E a linha citada existe nele? */
	codeLocation?: (file: string, line?: number) => { exists: boolean; hasLine: boolean } | undefined;
	/** O identificador de teste é conhecido? */
	testId?: (id: string) => boolean | undefined;
}

export interface VerifyOptions extends Resolvers {
	/** Prazo padrão em dias. */
	freshnessDays: number;
	/** Agora, injetável para o teste não depender do calendário. */
	now?: number;
}

export function daysSince(iso: string, now: number): number | undefined {
	const timestamp = Date.parse(iso);
	if (Number.isNaN(timestamp)) return undefined;
	return Math.floor((now - timestamp) / 86_400_000);
}

/** Divide `src/auth/config.ts:42` em arquivo e linha. */
export function splitCodeReference(source: string): { file: string; line?: number } {
	const match = source.match(/^(.*?):(\d+)$/);
	if (!match) return { file: source.trim() };
	return { file: match[1].trim(), line: Number.parseInt(match[2], 10) };
}

function verifyEvidence(provenance: Provenance, options: VerifyOptions): EvidenceResult {
	const now = options.now ?? Date.now();
	const ageDays = provenance.verifiedAt ? daysSince(provenance.verifiedAt, now) : undefined;
	const limit = provenance.freshnessDays ?? options.freshnessDays;

	/**
	 * A data só é aplicada **depois** de a evidência conferir. Uma evidência
	 * inválida com confirmação de ontem continua inválida: o endpoint não existe
	 * mais, e a data recente não muda isso — só documenta que a conferência de
	 * ontem não olhou o que devia.
	 */
	const withFreshness = (detail: string): EvidenceResult => {
		if (ageDays === undefined) {
			return {
				provenance,
				// Evidência que confere mas nunca foi confirmada por ninguém não é
				// "verificada": ninguém assinou embaixo.
				status: 'unverified',
				detail: `${detail} Sem data de verificação.`,
			};
		}

		if (ageDays > limit) {
			return {
				provenance,
				status: 'stale',
				detail: `${detail} Última verificação há ${ageDays} dias (prazo de ${limit}).`,
				ageDays,
			};
		}

		return { provenance, status: 'verified', detail, ageDays };
	};

	switch (provenance.sourceType) {
		case 'openapi':
		case 'asyncapi': {
			const resolver = provenance.sourceType === 'openapi' ? options.openapiPointer : options.asyncapiPointer;
			const exists = resolver?.(provenance.source);

			if (exists === undefined) {
				return {
					provenance,
					status: 'unverified',
					detail: 'A especificação citada não foi encontrada para conferir o ponteiro.',
					ageDays,
				};
			}
			if (!exists) {
				return {
					provenance,
					status: 'invalid',
					detail: `O ponteiro \`${provenance.source}\` não existe na especificação.`,
					ageDays,
				};
			}

			return withFreshness('O ponteiro existe na especificação.');
		}

		case 'code': {
			const { file, line } = splitCodeReference(provenance.source);
			const found = options.codeLocation?.(file, line);

			if (found === undefined) return { provenance, status: 'unverified', detail: 'Não foi possível olhar o código.', ageDays };
			if (!found.exists) return { provenance, status: 'invalid', detail: `O arquivo \`${file}\` não existe.`, ageDays };
			if (line !== undefined && !found.hasLine) {
				// O arquivo encurtou: a linha citada não existe mais. A referência
				// aponta para o vazio, e isso é diferente de estar velha.
				return { provenance, status: 'invalid', detail: `\`${file}\` não tem a linha ${line}.`, ageDays };
			}

			return withFreshness(line === undefined ? `\`${file}\` existe.` : `\`${file}\` tem a linha ${line}.`);
		}

		case 'test': {
			const known = options.testId?.(provenance.source);
			if (known === undefined) return { provenance, status: 'unverified', detail: 'Não foi possível conferir o teste.', ageDays };
			if (!known) {
				return { provenance, status: 'invalid', detail: `Não existe teste com o id \`${provenance.source}\`.`, ageDays };
			}
			return withFreshness(`O teste \`${provenance.source}\` existe.`);
		}

		case 'manual':
			// Não há o que conferir automaticamente: a evidência **é** a assinatura de
			// alguém. Então o que decide é a data — e sem data ela é só uma alegação.
			return provenance.verifiedAt
				? withFreshness(`Confirmado por ${provenance.verifiedBy ?? provenance.owner ?? 'pessoa não identificada'}.`)
				: {
						provenance,
						status: 'unverified',
						detail: 'Verificação manual declarada sem data — não há como saber se ainda vale.',
					};

		case 'generated':
			return withFreshness(`Gerado a partir de \`${provenance.source}\`.`);
	}
}

export function verifyClaim(claim: Claim, options: VerifyOptions): VerifiedClaim {
	const evidence = claim.provenance.map((provenance) => verifyEvidence(provenance, options));
	return { ...claim, evidence, status: worstStatus(evidence.map((item) => item.status)) };
}

export function verifyClaims(claims: readonly Claim[], options: VerifyOptions): VerifiedClaim[] {
	return claims.map((claim) => verifyClaim(claim, options));
}

/**
 * Resolve um ponteiro `arquivo#/caminho/json` dentro de um documento já lido.
 *
 * O escape do JSON Pointer é o da RFC 6901, que é o que a spec usa no exemplo
 * (`~1users` para `/users`). Sem desfazer o escape, todo ponteiro de caminho de
 * API seria declarado inexistente.
 */
export function resolveJsonPointer(document: unknown, pointer: string): unknown {
	const fragment = pointer.includes('#') ? pointer.slice(pointer.indexOf('#') + 1) : pointer;
	if (fragment === '' || fragment === '/') return document;

	let current: unknown = document;

	for (const rawSegment of fragment.replace(/^\//, '').split('/')) {
		const segment = decodeURIComponent(rawSegment).replace(/~1/g, '/').replace(/~0/g, '~');
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[segment];
		if (current === undefined) return undefined;
	}

	return current;
}

export function statusFor(claims: readonly VerifiedClaim[]): VerificationStatus {
	return worstStatus(claims.map((claim) => claim.status));
}
