import { useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, FileText, Puzzle, Search, X } from 'lucide-react';
import { searchContent } from './api';
import type { ContentRoot, SearchHit } from './types';

interface SearchModalProps {
	onClose: () => void;
	/** Abre o arquivo e posiciona o cursor na linha da ocorrência. */
	onOpenHit: (path: string, root: ContentRoot, line: number) => void;
	initialQuery?: string;
}

/** Fase 5 — busca global em todo o conteúdo (§37). */
export default function SearchModal({ onClose, onOpenHit, initialQuery = '' }: SearchModalProps) {
	const [query, setQuery] = useState(initialQuery);
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const requestId = useRef(0);

	useEffect(() => {
		const term = query.trim();
		if (term.length < 2) {
			setHits([]);
			setLoading(false);
			return;
		}

		// Debounce: buscar a cada tecla varreria o repositório inteiro sem necessidade.
		const id = ++requestId.current;
		setLoading(true);
		const timer = window.setTimeout(() => {
			searchContent(term, caseSensitive)
				.then((res) => {
					// Descarta respostas de buscas que já foram substituídas por outra.
					if (id !== requestId.current) return;
					setHits(res);
					setError(null);
				})
				.catch((err) => {
					if (id !== requestId.current) return;
					setError(err instanceof Error ? err.message : 'Erro na busca.');
				})
				.finally(() => {
					if (id === requestId.current) setLoading(false);
				});
		}, 250);

		return () => window.clearTimeout(timer);
	}, [query, caseSensitive]);

	// Agrupa por arquivo, como o painel de busca do VS Code.
	const grouped = useMemo(() => {
		const map = new Map<string, { root: ContentRoot; path: string; title?: string; hits: SearchHit[] }>();
		for (const hit of hits) {
			const key = `${hit.root}:${hit.path}`;
			const existing = map.get(key);
			if (existing) existing.hits.push(hit);
			else map.set(key, { root: hit.root, path: hit.path, title: hit.title, hits: [hit] });
		}
		return [...map.values()];
	}, [hits]);

	return (
		<div className="modal-backdrop modal-backdrop--top" role="presentation" onClick={onClose}>
			<div className="modal modal--search" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Buscar em todo o conteúdo</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Fechar">
						<X size={16} />
					</button>
				</div>

				<div className="modal-body">
					<div className="search-input-row">
						<Search size={15} />
						<input
							type="text"
							autoFocus
							placeholder="Buscar… (mínimo 2 caracteres)"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => e.key === 'Escape' && onClose()}
						/>
						<button
							type="button"
							className={`icon-btn${caseSensitive ? ' icon-btn--on' : ''}`}
							onClick={() => setCaseSensitive((v) => !v)}
							title="Diferenciar maiúsculas de minúsculas"
						>
							<CaseSensitive size={15} />
						</button>
					</div>

					{error && <p className="modal-error">{error}</p>}
					{loading && <p className="reusable-loading">Buscando…</p>}
					{!loading && query.trim().length >= 2 && hits.length === 0 && !error && (
						<p className="reusable-empty">Nenhuma ocorrência.</p>
					)}

					{hits.length > 0 && (
						<p className="search-summary">
							{hits.length} ocorrência{hits.length > 1 ? 's' : ''} em {grouped.length} arquivo
							{grouped.length > 1 ? 's' : ''}
						</p>
					)}

					<div className="search-results">
						{grouped.map((group) => (
							<div key={`${group.root}:${group.path}`} className="search-group">
								<p className="search-group-title">
									{group.root === 'snippets' ? <Puzzle size={13} /> : <FileText size={13} />}
									<span>{group.title || group.path}</span>
									<span className="search-group-path">{group.path}</span>
								</p>
								{group.hits.map((hit, index) => (
									<button
										key={`${hit.line}-${hit.matchStart}-${index}`}
										type="button"
										className="search-hit"
										onClick={() => {
											onClose();
											onOpenHit(hit.path, hit.root, hit.line);
										}}
									>
										<span className="search-hit-line">L{hit.line}</span>
										<span className="search-hit-text">
											{hit.text.slice(0, hit.matchStart)}
											<mark>{hit.text.slice(hit.matchStart, hit.matchStart + hit.matchLength)}</mark>
											{hit.text.slice(hit.matchStart + hit.matchLength)}
										</span>
										{hit.inFrontmatter && <span className="search-hit-badge">frontmatter</span>}
									</button>
								))}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
