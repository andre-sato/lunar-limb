import { useCallback, useEffect, useState } from 'react';
import { fetchReferences, type ReferencesResponse } from './api';
import type { ContentRoot } from './types';

const EMPTY: ReferencesResponse = {
	uses: [],
	usedBy: [],
	impact: { direct: [], indirect: [], total: 0, unresolved: [] },
	problems: [],
};

/**
 * Fase 4 — estado bidirecional do arquivo aberto.
 *
 * Fica aqui, e não dentro do ReferencePanel, porque três lugares diferentes
 * consomem o mesmo resultado: o painel de referências, o Problems panel e as
 * decorações do Monaco (que marcam as linhas com referência reutilizável).
 */
export function useReferences(path: string | null, root: ContentRoot, refreshToken: number) {
	const [data, setData] = useState<ReferencesResponse>(EMPTY);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		if (!path) {
			setData(EMPTY);
			setError(null);
			return;
		}
		setLoading(true);
		try {
			setData(await fetchReferences(path, root));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar referências.');
		} finally {
			setLoading(false);
		}
	}, [path, root]);

	useEffect(() => {
		let cancelled = false;
		if (!path) {
			setData(EMPTY);
			setError(null);
			return;
		}
		setLoading(true);
		fetchReferences(path, root)
			.then((res) => {
				if (cancelled) return;
				setData(res);
				setError(null);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar referências.');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [path, root, refreshToken]);

	return { ...data, loading, error, reload };
}
