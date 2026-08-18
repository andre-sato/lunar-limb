import { useMemo, useState } from 'react';
import type { ApiOperation, SecurityScheme } from '../../lib/api-explorer/model';
import {
	SNIPPET_LABELS,
	generateSnippet,
	type SnippetLanguage,
	type RequestSpec,
} from '../../lib/api-explorer/snippets';
import { buildRequest, missingRequired } from '../../lib/api-explorer/request';

/**
 * Explorador de um endpoint: formulário, envio e resposta (§3, §4, §7).
 *
 * O formulário é **derivado da especificação** — nenhum campo é escrito aqui.
 * Trocar a especificação muda o formulário, e é isso que impede o Explorer de
 * envelhecer em relação à API.
 *
 * A credencial vive apenas no estado deste componente: não vai para
 * `localStorage`, não entra no histórico e não aparece nos exemplos de código
 * (§5, §9). Recarregar a página a apaga, e isso é o comportamento desejado.
 */

interface Props {
	operation: ApiOperation;
	servers: string[];
	schemes: SecurityScheme[];
}

interface ResponseState {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
	durationMs: number;
	size: number;
	truncated: boolean;
}

/** Uma entrada do histórico local — sem credencial, por construção (§9). */
interface HistoryEntry {
	method: string;
	url: string;
	status: number;
	at: string;
}

function prettyBody(body: string, contentType: string | undefined): { text: string; json: boolean } {
	if (contentType?.includes('json') || /^[\s]*[{[]/.test(body)) {
		try {
			return { text: JSON.stringify(JSON.parse(body), null, 2), json: true };
		} catch {
			// Corpo que se anuncia JSON e não é: mostrar cru é mais útil que erro.
		}
	}
	return { text: body, json: false };
}

export default function ApiExplorer({ operation, servers, schemes }: Props) {
	const [server, setServer] = useState(servers[0] ?? '');
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(operation.parameters.map((parameter) => [parameter.name, parameter.example ?? '']))
	);
	const [body, setBody] = useState(operation.requestBody?.example ?? '');
	const [schemeId, setSchemeId] = useState(operation.security[0]?.id ?? '');
	const [credential, setCredential] = useState('');
	const [language, setLanguage] = useState<SnippetLanguage>('curl');
	const [pretty, setPretty] = useState(true);
	const [response, setResponse] = useState<ResponseState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const [copied, setCopied] = useState(false);

	const scheme = schemes.find((candidate) => candidate.id === schemeId);

	/**
	 * O pedido, montado pela mesma função que os exemplos de código usam.
	 * A lógica vive em `lib/api-explorer/request.ts` porque lá ela é testável
	 * sem navegador — ver o comentário do módulo.
	 */
	const request = useMemo<RequestSpec>(
		() =>
			buildRequest({
				operation,
				server,
				origin: typeof window === 'undefined' ? '' : window.location.origin,
				values,
				body,
				credential,
				scheme,
			}),
		[operation, server, values, body, credential, scheme]
	);

	const missing = missingRequired(operation, values);

	async function send() {
		setBusy(true);
		setError(null);
		setResponse(null);
		try {
			const result = await fetch('/api/explorer/request', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(request),
			});
			const data = await result.json();
			if (!result.ok) throw new Error(data.error ?? 'A chamada falhou.');

			setResponse(data);
			// O histórico guarda método, URL e status — nunca cabeçalho nem corpo,
			// que é onde a credencial estaria.
			setHistory((entries) =>
				[{ method: request.method, url: request.url, status: data.status, at: new Date().toLocaleTimeString('pt-BR') }, ...entries].slice(0, 8)
			);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'A chamada falhou.');
		} finally {
			setBusy(false);
		}
	}

	const snippet = generateSnippet(language, request);
	const shown = response ? prettyBody(response.body, response.headers['content-type']) : null;

	return (
		<div className="explorer">
			<header className="explorer__header">
				<span className={`explorer__method explorer__method--${operation.method}`}>
					{operation.method.toUpperCase()}
				</span>
				<code className="explorer__path">{operation.path}</code>
				{operation.deprecated && <span className="explorer__deprecated">obsoleto</span>}
			</header>

			{operation.summary && <p className="explorer__summary">{operation.summary}</p>}

			{servers.length > 1 && (
				<label className="explorer__field">
					<span>Servidor</span>
					<select value={server} onChange={(event) => setServer(event.target.value)}>
						{servers.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</label>
			)}

			{operation.security.length > 0 && (
				<fieldset className="explorer__group">
					<legend>Autenticação</legend>
					{operation.security.length > 1 && (
						<label className="explorer__field">
							<span>Esquema</span>
							<select value={schemeId} onChange={(event) => setSchemeId(event.target.value)}>
								{operation.security.map((option) => (
									<option key={option.id} value={option.id}>
										{option.id}
									</option>
								))}
							</select>
						</label>
					)}
					<label className="explorer__field">
						<span>{scheme?.kind === 'apiKey' ? (scheme.name ?? 'Chave') : 'Credencial'}</span>
						<input
							type="password"
							value={credential}
							placeholder="cole aqui — fica só nesta aba"
							onChange={(event) => setCredential(event.target.value)}
						/>
					</label>
					<p className="explorer__hint">
						A credencial não é salva, não entra no histórico e não aparece nos exemplos de código.
					</p>
				</fieldset>
			)}

			{operation.parameters.length > 0 && (
				<fieldset className="explorer__group">
					<legend>Parâmetros</legend>
					{operation.parameters.map((parameter) => (
						<label className="explorer__field" key={`${parameter.location}-${parameter.name}`}>
							<span>
								{parameter.name}
								{parameter.required && <em className="explorer__required"> obrigatório</em>}
								<em className="explorer__where">{parameter.location}</em>
							</span>
							{parameter.enum ? (
								<select
									value={values[parameter.name] ?? ''}
									onChange={(event) => setValues({ ...values, [parameter.name]: event.target.value })}
								>
									<option value="">—</option>
									{parameter.enum.map((option) => (
										<option key={option} value={option}>
											{option}
										</option>
									))}
								</select>
							) : (
								<input
									type="text"
									value={values[parameter.name] ?? ''}
									placeholder={parameter.description ?? parameter.type}
									onChange={(event) => setValues({ ...values, [parameter.name]: event.target.value })}
								/>
							)}
						</label>
					))}
				</fieldset>
			)}

			{operation.requestBody && (
				<fieldset className="explorer__group">
					<legend>Corpo ({operation.requestBody.contentType})</legend>
					<textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} spellCheck={false} />
				</fieldset>
			)}

			<div className="explorer__request">
				<code>
					{request.method.toUpperCase()} {request.url}
				</code>
			</div>

			<div className="explorer__actions">
				<button type="button" className="explorer__send" disabled={busy || missing.length > 0} onClick={() => void send()}>
					{busy ? 'Enviando…' : 'Enviar'}
				</button>
				{missing.length > 0 && <span className="explorer__hint">Falta preencher: {missing.join(', ')}</span>}
			</div>

			{error && <p className="explorer__error">{error}</p>}

			{response && (
				<section className="explorer__response">
					<header>
						<span className={`explorer__status explorer__status--${String(response.status)[0]}`}>
							{response.status} {response.statusText}
						</span>
						<span className="explorer__meta">
							{response.durationMs} ms · {response.size} bytes
						</span>
						<span className="explorer__toggle">
							<button type="button" className={pretty ? 'is-active' : ''} onClick={() => setPretty(true)}>
								Formatado
							</button>
							<button type="button" className={pretty ? '' : 'is-active'} onClick={() => setPretty(false)}>
								Cru
							</button>
						</span>
					</header>

					{response.truncated && <p className="explorer__hint">Resposta cortada para exibição.</p>}

					<pre className="explorer__body">
						<code>{pretty && shown ? shown.text : response.body}</code>
					</pre>

					<details className="explorer__headers">
						<summary>Cabeçalhos da resposta</summary>
						<dl>
							{Object.entries(response.headers).map(([name, value]) => (
								<div key={name}>
									<dt>{name}</dt>
									<dd>{value}</dd>
								</div>
							))}
						</dl>
					</details>
				</section>
			)}

			<section className="explorer__snippets">
				<header>
					<span className="explorer__tabs">
						{(Object.keys(SNIPPET_LABELS) as SnippetLanguage[]).map((option) => (
							<button
								key={option}
								type="button"
								className={option === language ? 'is-active' : ''}
								onClick={() => setLanguage(option)}
							>
								{SNIPPET_LABELS[option]}
							</button>
						))}
					</span>
					<button
						type="button"
						className="explorer__copy"
						onClick={() => {
							void navigator.clipboard.writeText(snippet).then(() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							});
						}}
					>
						{copied ? 'Copiado' : 'Copiar'}
					</button>
				</header>
				<pre>
					<code>{snippet}</code>
				</pre>
			</section>

			{history.length > 0 && (
				<section className="explorer__history">
					<h4>Chamadas recentes</h4>
					<ul>
						{history.map((entry, index) => (
							<li key={`${entry.at}-${index}`}>
								<span className={`explorer__status explorer__status--${String(entry.status)[0]}`}>{entry.status}</span>
								<code>
									{entry.method.toUpperCase()} {entry.url}
								</code>
								<time>{entry.at}</time>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
