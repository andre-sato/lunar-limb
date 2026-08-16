import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, RefreshCw } from 'lucide-react';
import { fetchReferences } from './api';
import type { ContentReference, ContentRoot } from './types';

interface ReferencePanelProps {
	path: string;
	root: ContentRoot;
	onNavigateById: (id: string, type: 'block' | 'page') => void;
	onNavigatePath: (path: string, root: ContentRoot) => void;
	/** Bumped by the parent after a save, to trigger a re-fetch. */
	refreshToken: number;
}

export default function ReferencePanel({ path, root, onNavigateById, onNavigatePath, refreshToken }: ReferencePanelProps) {
	const [uses, setUses] = useState<ContentReference[]>([]);
	const [usedBy, setUsedBy] = useState<ContentReference[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		fetchReferences(path, root)
			.then((res) => {
				if (cancelled) return;
				setUses(res.uses);
				setUsedBy(res.usedBy);
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

	if (loading && uses.length === 0 && usedBy.length === 0) {
		return (
			<div className="reference-panel">
				<RefreshCw size={13} className="spin" />
			</div>
		);
	}

	if (error) {
		return <div className="reference-panel reference-panel--error">{error}</div>;
	}

	if (uses.length === 0 && usedBy.length === 0) return null;

	return (
		<div className="reference-panel">
			{uses.length > 0 && (
				<div className="reference-group">
					<p className="reference-group-title">
						<ArrowUpRight size={12} /> Esta página usa
					</p>
					{uses.map((ref) => (
						<button key={`${ref.target}-${ref.type}`} type="button" onClick={() => onNavigateById(ref.target, ref.type)}>
							{ref.target}
						</button>
					))}
				</div>
			)}
			{usedBy.length > 0 && (
				<div className="reference-group">
					<p className="reference-group-title">
						<ArrowDownLeft size={12} /> Usado por {usedBy.length} página{usedBy.length > 1 ? 's' : ''}
					</p>
					{usedBy.map((ref) => (
						<button
							key={ref.source}
							type="button"
							onClick={() => onNavigatePath(sourcePath(ref.source), sourceType(ref.source) === 'block' ? 'snippets' : 'docs')}
						>
							{sourcePath(ref.source)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function sourcePath(source: string): string {
	const idx = source.indexOf(':');
	return idx === -1 ? source : source.slice(idx + 1);
}

function sourceType(source: string): 'block' | 'page' {
	return source.startsWith('snippets:') ? 'block' : 'page';
}
