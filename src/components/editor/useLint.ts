import { useEffect, useRef, useState } from 'react';
import type { LintResult } from '../../lib/linter/types';

/**
 * Executa o linter sobre o conteúdo do editor.
 *
 * A §65 pede para não analisar a cada tecla. A análise determinística é barata,
 * mas roda no servidor: sem debounce, digitar geraria uma requisição por
 * caractere. O atraso é maior que o do preview porque o resultado do linter
 * muda menos e incomoda mais quando pisca.
 *
 * O autor continua editando enquanto a análise roda (§66) — nada aqui bloqueia
 * a interface, e um resultado que chega fora de ordem é descartado.
 */
const DEBOUNCE_MS = 1200;

export interface LintState {
	result: LintResult | null;
	running: boolean;
	error: string | null;
	/** Dispara uma análise imediata, para o comando "Lint document". */
	runNow: () => void;
}

export function useLint(path: string | null, content: string, enabled = true): LintState {
	const [result, setResult] = useState<LintResult | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [manualToken, setManualToken] = useState(0);

	/** Sequência da requisição, para ignorar respostas atrasadas. */
	const requestRef = useRef(0);

	useEffect(() => {
		if (!enabled || !path) {
			setResult(null);
			return;
		}

		const handle = setTimeout(async () => {
			const sequence = ++requestRef.current;
			setRunning(true);
			setError(null);

			try {
				const response = await fetch('/api/editor/lint', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ path, content }),
				});

				if (sequence !== requestRef.current) return;

				if (!response.ok) {
					const body = await response.json().catch(() => ({}));
					setError(body.error ?? 'Não foi possível analisar o documento.');
					return;
				}

				setResult(await response.json());
			} catch {
				if (sequence === requestRef.current) setError('Não foi possível analisar o documento.');
			} finally {
				if (sequence === requestRef.current) setRunning(false);
			}
		}, manualToken > 0 ? 0 : DEBOUNCE_MS);

		return () => clearTimeout(handle);
	}, [path, content, enabled, manualToken]);

	return {
		result,
		running,
		error,
		runNow: () => setManualToken((token) => token + 1),
	};
}
