/**
 * Settings → Busca na documentação.
 *
 * Uma tela curta, porque a funcionalidade é curta: quantos trechos devolver,
 * qual a relevância mínima, quanto texto por trecho e qual o limite de uso. Não
 * há chave, modelo nem provedor para configurar.
 */

import { useEffect, useState } from 'react';

interface ChatConfig {
	enabled: boolean;
	maxExcerpts: number;
	minScore: number;
	excerptChars: number;
	rateLimitPerHour: number;
}

interface Payload {
	config: ChatConfig;
	quality: { total: number; up: number; down: number; satisfaction: number | null };
	activeConversations: number;
	rateLimitHits: number;
}

export default function ChatbotPanel() {
	const [data, setData] = useState<Payload | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	async function load() {
		try {
			const response = await fetch('/api/admin/integrations/chat');
			if (!response.ok) throw new Error('Falha ao carregar a configuração.');
			setData(await response.json());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Falha ao carregar.');
		}
	}

	useEffect(() => {
		void load();
	}, []);

	function patch(changes: Partial<ChatConfig>) {
		setData((current) => (current ? { ...current, config: { ...current.config, ...changes } } : current));
	}

	async function save() {
		if (!data) return;
		setSaving(true);
		setError(null);
		setStatus(null);

		try {
			const response = await fetch('/api/admin/integrations/chat', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(data.config),
			});
			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(body?.message ?? 'Não foi possível salvar.');

			setStatus('Configuração salva.');
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.');
		} finally {
			setSaving(false);
		}
	}

	if (error && !data) return <p className="panel-error">{error}</p>;
	if (!data) return <p>Carregando…</p>;

	const { config, quality } = data;

	return (
		<div className="chatbot-panel">
			<p className="panel-notice">
				A busca responde <strong>somente com trechos da própria documentação</strong>, cada um com o
				link da página. Não há modelo de linguagem envolvido: nada é redigido, resumido ou inferido —
				o que aparece na tela está publicado em alguma página.
			</p>

			<section>
				<h2>Configuração</h2>

				<label className="chatbot-panel__check">
					<input
						type="checkbox"
						checked={config.enabled}
						onChange={(event) => patch({ enabled: event.target.checked })}
					/>
					Busca disponível para os leitores
				</label>

				<div className="chatbot-panel__grid">
					<label>
						Trechos por busca
						<input
							type="number"
							min={1}
							max={20}
							value={config.maxExcerpts}
							onChange={(event) => patch({ maxExcerpts: Number(event.target.value) })}
						/>
					</label>
					<label>
						Relevância mínima (0–1)
						<input
							type="number"
							min={0}
							max={1}
							step={0.05}
							value={config.minScore}
							onChange={(event) => patch({ minScore: Number(event.target.value) })}
						/>
					</label>
					<label>
						Caracteres por trecho
						<input
							type="number"
							min={200}
							max={4000}
							step={50}
							value={config.excerptChars}
							onChange={(event) => patch({ excerptChars: Number(event.target.value) })}
						/>
					</label>
					<label>
						Buscas por usuário/hora
						<input
							type="number"
							min={1}
							max={5000}
							value={config.rateLimitPerHour}
							onChange={(event) => patch({ rateLimitPerHour: Number(event.target.value) })}
						/>
					</label>
				</div>

				<p className="chatbot-panel__help">
					Relevância mínima alta devolve menos e melhor; baixa devolve mais e com ruído. Abaixo do
					limiar a busca diz que não encontrou, em vez de mostrar um trecho qualquer.
				</p>

				<div className="chatbot-panel__actions">
					<button type="button" onClick={() => void save()} disabled={saving}>
						{saving ? 'Salvando…' : 'Salvar'}
					</button>
					{status && <span className="chatbot-panel__ok">{status}</span>}
					{error && <span className="panel-error">{error}</span>}
				</div>
			</section>

			<section>
				<h2>Uso</h2>
				<dl className="chatbot-panel__stats">
					<div>
						<dt>Conversas ativas</dt>
						<dd>{data.activeConversations}</dd>
					</div>
					<div>
						<dt>Votos em resultados</dt>
						<dd>{quality.total}</dd>
					</div>
					<div>
						<dt>Úteis</dt>
						<dd>
							{quality.satisfaction === null
								? '—'
								: `${Math.round(quality.satisfaction * 100)}% (${quality.up}/${quality.total})`}
						</dd>
					</div>
					<div>
						<dt>Limites atingidos</dt>
						<dd>{data.rateLimitHits}</dd>
					</div>
				</dl>
				<p className="chatbot-panel__help">
					Os votos indicam se os trechos estão respondendo. Muitos “não útil” na mesma busca
					costumam significar que falta uma página, não que a busca esteja errada.
				</p>
			</section>
		</div>
	);
}
