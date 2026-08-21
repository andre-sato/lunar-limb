/**
 * Validação estrutural do overlay (spec § 6).
 *
 * A distinção que a spec faz e que este arquivo respeita: **validar o overlay
 * não é validar a aplicação dele sobre uma especificação.** Um overlay pode ser
 * perfeitamente válido e mirar um endpoint que não existe — o primeiro é assunto
 * daqui, o segundo aparece em `apply.ts` como alvo sem correspondência.
 *
 * Juntar os dois faria um overlay correto ser reprovado por causa do estado de
 * outro arquivo, e o autor não teria o que corrigir no seu.
 */

import { JsonPathError, parsePath } from './jsonpath';
import type { Overlay, ValidationIssue, ValidationResult } from './types';

/** A versão da Overlay Specification que este motor implementa. */
export const SUPPORTED_VERSION = '1.0.0';

function issue(code: string, message: string, severity: 'error' | 'warning', at?: string): ValidationIssue {
	return { code, message, severity, at };
}

export interface ValidateOptions {
	/** Exigir `x-lunar.owner` e `x-lunar.purpose` (spec § 23, § 24). */
	requireGovernance?: boolean;
}

export function validateOverlay(overlay: Overlay, options: ValidateOptions = {}): ValidationResult {
	const issues: ValidationIssue[] = [];

	// --- Documento -----------------------------------------------------------

	if (overlay.overlay === '') {
		issues.push(issue('OVL-001', 'Falta o campo `overlay` com a versão da especificação.', 'error'));
	} else if (overlay.overlay !== SUPPORTED_VERSION) {
		// Versão diferente é aviso, não erro: um overlay 1.0.1 provavelmente
		// funciona, e recusá-lo de saída obrigaria a editar arquivos que outra
		// equipe mantém. O relatório diz o que foi assumido.
		issues.push(
			issue(
				'OVL-002',
				`Versão \`${overlay.overlay}\` declarada; este motor implementa a ${SUPPORTED_VERSION}. As ações serão aplicadas mesmo assim.`,
				'warning'
			)
		);
	}

	if (overlay.info.title === '') issues.push(issue('OVL-003', 'Falta `info.title`.', 'error', 'info.title'));
	if (overlay.info.version === '') {
		issues.push(issue('OVL-004', 'Falta `info.version`.', 'error', 'info.version'));
	}

	if (overlay.actions.length === 0) {
		issues.push(
			issue('OVL-005', 'O overlay não tem nenhuma ação — aplicá-lo não muda nada.', 'error', 'actions')
		);
	}

	// --- Ações ---------------------------------------------------------------

	overlay.actions.forEach((action, index) => {
		const at = `actions[${index}]`;

		if (action.target === '') {
			issues.push(issue('OVL-006', 'Ação sem `target`.', 'error', `${at}.target`));
		} else {
			try {
				parsePath(action.target);
			} catch (error) {
				issues.push(
					issue(
						'OVL-007',
						error instanceof JsonPathError ? error.message : String(error),
						'error',
						`${at}.target`
					)
				);
			}
		}

		const hasUpdate = action.update !== undefined;

		if (!hasUpdate && !action.remove) {
			issues.push(
				issue('OVL-008', 'Ação sem `update` nem `remove`: ela não faria nada.', 'error', at)
			);
		}

		if (hasUpdate && action.remove) {
			// A spec § 12 resolve o empate — `remove` prevalece. Fica como aviso
			// porque o resultado é definido; o que não é claro é a intenção.
			issues.push(
				issue(
					'OVL-009',
					'Ação declara `update` e `remove`. `remove` prevalece, e o `update` é ignorado.',
					'warning',
					at
				)
			);
		}

		if (hasUpdate && (action.update === null || typeof action.update !== 'object')) {
			issues.push(
				issue(
					'OVL-010',
					'`update` precisa ser um mapa para ser mesclado no alvo.',
					'error',
					`${at}.update`
				)
			);
		}

		if (!action.description) {
			// Um overlay é lido meses depois por quem não o escreveu, e `remove:
			// true` sobre um JSONPath não explica por que aquele endpoint sumiu.
			issues.push(
				issue('OVL-011', 'Ação sem `description`: o motivo da alteração se perde.', 'warning', at)
			);
		}
	});

	// --- Governança ----------------------------------------------------------

	if (options.requireGovernance) {
		if (!overlay.governance.owner) {
			issues.push(issue('OVL-012', 'Falta `x-lunar.owner`.', 'error', 'x-lunar.owner'));
		}
		if (!overlay.governance.purpose) {
			issues.push(issue('OVL-013', 'Falta `x-lunar.purpose`.', 'error', 'x-lunar.purpose'));
		}
	}

	return { valid: !issues.some((entry) => entry.severity === 'error'), issues };
}
