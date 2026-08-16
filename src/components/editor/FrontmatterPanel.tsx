import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { buildContent, splitContent, updateField } from './frontmatter';

interface FrontmatterPanelProps {
	content: string;
	onChange: (nextContent: string) => void;
}

export default function FrontmatterPanel({ content, onChange }: FrontmatterPanelProps) {
	const [expanded, setExpanded] = useState(false);
	const { frontmatter, body, hasFrontmatter } = splitContent(content);

	function update(path: string[], value: string | number | undefined) {
		const next = updateField(frontmatter, path, value);
		onChange(buildContent(next, body));
	}

	const title = typeof frontmatter.title === 'string' ? frontmatter.title : '';
	const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
	const sidebar =
		frontmatter.sidebar && typeof frontmatter.sidebar === 'object' && !Array.isArray(frontmatter.sidebar)
			? (frontmatter.sidebar as Record<string, unknown>)
			: {};
	const sidebarLabel = typeof sidebar.label === 'string' ? sidebar.label : '';
	const sidebarOrder = typeof sidebar.order === 'number' ? String(sidebar.order) : '';

	const titleMissing = title.trim() === '';

	if (!hasFrontmatter) {
		// New/legacy file without a frontmatter block yet — offer to create one.
		return (
			<div className="frontmatter-panel frontmatter-panel--empty">
				<span>Este arquivo não tem frontmatter.</span>
				<button
					type="button"
					onClick={() => onChange(buildContent({ title: '' }, content))}
				>
					Adicionar frontmatter
				</button>
			</div>
		);
	}

	return (
		<div className={`frontmatter-panel${titleMissing ? ' frontmatter-panel--error' : ''}`}>
			<button type="button" className="frontmatter-toggle" onClick={() => setExpanded((v) => !v)}>
				{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				<span>Metadados da página</span>
				{!expanded && <span className="frontmatter-summary">{title || '(sem título)'}</span>}
				{titleMissing && <span className="frontmatter-badge">título obrigatório</span>}
			</button>

			{expanded && (
				<div className="frontmatter-grid">
					<label>
						Title
						<input
							type="text"
							value={title}
							className={titleMissing ? 'field-error' : ''}
							onChange={(e) => update(['title'], e.target.value)}
						/>
					</label>
					<label>
						Description
						<input type="text" value={description} onChange={(e) => update(['description'], e.target.value)} />
					</label>
					<label>
						Sidebar Label
						<input type="text" value={sidebarLabel} onChange={(e) => update(['sidebar', 'label'], e.target.value)} />
					</label>
					<label>
						Order
						<input
							type="number"
							value={sidebarOrder}
							onChange={(e) => update(['sidebar', 'order'], e.target.value === '' ? undefined : Number(e.target.value))}
						/>
					</label>
				</div>
			)}
		</div>
	);
}
