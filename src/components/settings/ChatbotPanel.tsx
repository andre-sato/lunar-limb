/**
 * Settings → Chatbot (§67–§71).
 *
 * Três blocos: Configuração (provedor, modelo, retrieval), Segurança
 * (incidentes registrados) e Uso (satisfação e conversas ativas).
 *
 * O campo da chave começa sempre vazio e a resposta do servidor nunca a traz —
 * só `hasApiKey` e a dica mascarada. Quem salva sem digitar nada preserva a
 * chave existente.
 */

import { useEffect, useState } from 'react';

interface ConfigView {
	enabled: boolean;
	provider: string;
	model: string;
	maxOutputTokens: number;
	effort: 'low' | 'medium' | 'high';
	retrievalThreshold: number;
	maxChunks: number;
	rateLimitPerHour: number;
	generationEnabled: boolean;
	hasApiKey: boolean;
	apiKeyHint: string;
	samplingUnavailable: boolean;
	retrievalOnly: boolean;
}

interface Quality {
	total: number;
	up: number;
	down: number;
	satisfaction: number | null;
}

interface Payload {
	config: ConfigView;
	models: ReadonlyArray<{ id: string; label: string }>;
	quality: Quality;
	incidents: Record<string, number>;
	activeConversations: number;
}

const INCIDENT_LABELS: Record<string, string> = {
	CHAT_PROMPT_INJECTION: 'Tentativas de injeção de prompt',
	CHAT_JAILBREAK: 'Tentativas de jailbreak',
	CHAT_INDIRECT_INJECTION: 'Instrução encontrada dentro da documentação',
	CHAT_BLOCKED: 'Mensagens recusadas',
	CHAT_OUTPUT_BLOCKED: 'Respostas bloqueadas na saída',
	CHAT_RATE_LIMITED: 'Limites de uso atingidos',
};

export default function ChatbotPanel() {
	const [data, setData] = useState<Payload | null>(null);
	const [apiKey, setApiKey] = useState('');
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

	function patch(changes: Partial<ConfigView>) {
		setData((current) => (current ? { ...current, config: { ...current.config, ...changes } } : current));
	}

	async function save(extra: Record<string, unknown> = {}) {
		if (!data) return;
		setSaving(true);
		setError(null);
		setStatus(null);

		try {
			const response = await fetch('/api/admin/integrations/chat', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					enabled: data.config.enabled,
					generationEnabled: data.config.generationEnabled,
					model: data.config.model,
					effort: data.config.effort,
					maxOutputTokens: data.config.maxOutputTokens,
					retrievalThreshold: data.config.retrievalThreshold,
					maxChunks: data.config.maxChunks,
					rateLimitPerHour: data.config.rateLimitPerHour,
					// Só vai quando o admin digitou algo.
					...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
					...extra,
				}),
			});

			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(body?.message ?? 'Não foi possível salvar.');

			setApiKey('');
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

	const { config, models, quality, incidents } = data;
	const totalIncidents = Object.values(incidents).reduce((sum, value) => sum + value, 0);

	return (
		<div className="chatbot-panel">
			{config.retrievalOnly && (
				<p className="panel-notice">
					O assistente está em <strong>modo só-retrieval</strong>: ele devolve os trechos encontrados
					na documentação, com as fontes, sem redigir a resposta. Configure a chave da API para
					habilitar respostas em linguagem natural.
				</p>
			)}

			<section>
				<h2>Configuração</h2>

				<label className="chatbot-panel__check">
					<input
						type="checkbox"
						checked={config.enabled}
						onChange={(event) => patch({ enabled: event.target.checked })}
					/>
					Assistente disponível para os leitores
				</label>

				<label className="chatbot-panel__check">
					<input
						type="checkbox"
						checked={config.generationEnabled}
						onChange={(event) => patch({ generationEnabled: event.target.checked })}
					/>
					Gerar respostas com o modelo (desmarcado: só trechos da documentação)
				</label>

				<label>
					Chave da API {config.hasApiKey && <span className="chatbot-panel__hint">({config.apiKeyHint})</span>}
					<input
						type="password"
						value={apiKey}
						autoComplete="off"
						placeholder={config.hasApiKey ? 'Deixe vazio para manter a chave atual' : 'sk-…'}
						onChange={(event) => setApiKey(event.target.value)}
					/>
				</label>
				<p className="chatbot-panel__help">
					A chave fica no servidor, em <code>data/integrations.json</code>, e nunca é devolvida por
					nenhuma rota — nem para você. Também pode vir de <code>ANTHROPIC_API_KEY</code>.
				</p>
				{config.hasApiKey && (
					<button type="button" className="chatbot-panel__danger" onClick={() => void save({ removeApiKey: true })}>
						Remover a chave
					</button>
				)}

				<label>
					Modelo
					<select value={config.model} onChange={(event) => patch({ model: event.target.value })}>
						{models.map((model) => (
							<option key={model.id} value={model.id}>
								{model.label}
							</option>
						))}
					</select>
				</label>

				<label>
					Profundidade de raciocínio
					<select
						value={config.effort}
						onChange={(event) => patch({ effort: event.target.value as ConfigView['effort'] })}
					>
						<option value="low">Baixa — mais rápida, suficiente para documentação</option>
						<option value="medium">Média</option>
						<option value="high">Alta — mais lenta e mais caro</option>
					</select>
				</label>

				<div className="chatbot-panel__grid">
					<label>
						Tokens máximos por resposta
						<input
							type="number"
							min={256}
							max={8192}
							value={config.maxOutputTokens}
							onChange={(event) => patch({ maxOutputTokens: Number(event.target.value) })}
						/>
					</label>
					<label>
						Fragmentos por consulta
						<input
							type="number"
							min={1}
							max={20}
							value={config.maxChunks}
							onChange={(event) => patch({ maxChunks: Number(event.target.value) })}
						/>
					</label>
					<label>
						Relevância mínima (0–1)
						<input
							type="number"
							min={0}
							max={1}
							step={0.05}
							value={config.retrievalThreshold}
							onChange={(event) => patch({ retrievalThreshold: Number(event.target.value) })}
						/>
					</label>
					<label>
						Mensagens por usuário/hora
						<input
							type="number"
							min={1}
							max={1000}
							value={config.rateLimitPerHour}
							onChange={(event) => patch({ rateLimitPerHour: Number(event.target.value) })}
						/>
					</label>
				</div>

				<p className="chatbot-panel__help">
					Abaixo da relevância mínima nada entra no contexto e o assistente responde que não
					encontrou — é o que impede resposta inventada quando a pergunta não tem base na
					documentação.
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
				<h2>Segurança</h2>
				{totalIncidents === 0 ? (
					<p>Nenhum incidente registrado nos últimos eventos de auditoria.</p>
				) : (
					<ul className="chatbot-panel__incidents">
						{Object.entries(incidents)
							.filter(([, count]) => count > 0)
							.map(([action, count]) => (
								<li key={action}>
									<strong>{count}</strong> {INCIDENT_LABELS[action] ?? action}
								</li>
							))}
					</ul>
				)}
				<p className="chatbot-panel__help">
					Os registros guardam categoria de risco e contadores — nunca a pergunta nem a resposta.
					“Instrução encontrada dentro da documentação” aponta uma página que vale revisar.
				</p>
			</section>

			<section>
				<h2>Uso</h2>
				<dl className="chatbot-panel__stats">
					<div>
						<dt>Conversas ativas</dt>
						<dd>{data.activeConversations}</dd>
					</div>
					<div>
						<dt>Votos em respostas</dt>
						<dd>{quality.total}</dd>
					</div>
					<div>
						<dt>Satisfação</dt>
						<dd>
							{quality.satisfaction === null
								? '—'
								: `${Math.round(quality.satisfaction * 100)}% (${quality.up}/${quality.total})`}
						</dd>
					</div>
				</dl>
			</section>
		</div>
	);
}
