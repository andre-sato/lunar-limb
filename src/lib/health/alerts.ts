/**
 * Alertas de SLO (§10).
 *
 * Três canais: a interface (que é o painel, e não precisa de nada aqui), um
 * webhook e uma issue no provedor.
 *
 * Duas decisões que valem estar no código, não só na cabeça de quem escreveu.
 *
 * **Nada é enviado automaticamente.** O disparo é uma ação explícita de quem
 * administra o portal. Um alerta que sai sozinho a cada análise vira notificação
 * repetida no canal da equipe — e a primeira coisa que se faz com notificação
 * repetida é silenciá-la, o que mata justamente o alerta que importava.
 *
 * **O destino vem do ambiente.** `DOCS_HEALTH_WEBHOOK` e `GITHUB_TOKEN` nunca
 * entram no repositório nem na interface. URL de webhook costuma carregar segredo
 * no próprio caminho.
 */

import { getRemote, providerToken } from '../git/pull-request';
import { webhookUrl } from './config';

export interface AlertResult {
	channel: 'webhook' | 'issue';
	sent: boolean;
	/** Onde foi, quando foi. Nunca inclui token nem a URL completa do webhook. */
	detail: string;
}

/**
 * Envia o alerta ao webhook configurado.
 *
 * O corpo é `{ text }`, que é o formato que Slack, Mattermost e a maioria dos
 * receptores de webhook aceitam sem adaptador. A resposta do destino não é
 * repassada: ela pode conter conteúdo de terceiro, e o que interessa é se foi.
 */
export async function sendWebhookAlert(message: string, timeoutMs = 8000): Promise<AlertResult> {
	const url = webhookUrl();
	if (url === '') {
		return { channel: 'webhook', sent: false, detail: 'DOCS_HEALTH_WEBHOOK não está configurado.' };
	}

	let host: string;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') {
			// Alerta de SLO em texto claro atravessando a rede é dado interno da
			// equipe indo aberto. `https` não é opcional aqui.
			return { channel: 'webhook', sent: false, detail: 'O webhook precisa ser https.' };
		}
		host = parsed.host;
	} catch {
		return { channel: 'webhook', sent: false, detail: 'DOCS_HEALTH_WEBHOOK não é uma URL válida.' };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: message }),
			signal: controller.signal,
		});

		// Só o host no detalhe: a URL inteira costuma ser o próprio segredo.
		return {
			channel: 'webhook',
			sent: response.ok,
			detail: response.ok ? `Enviado para ${host}.` : `${host} respondeu ${response.status}.`,
		};
	} catch (error) {
		return {
			channel: 'webhook',
			sent: false,
			detail: (error as Error).name === 'AbortError' ? 'Tempo esgotado.' : `Falha ao enviar: ${(error as Error).message}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Abre uma issue no provedor com o alerta.
 *
 * Reaproveita o remoto e o token que o fluxo de pull request já usa: um segundo
 * caminho de credencial para o mesmo provedor seria uma segunda coisa para
 * configurar, esquecer e depurar.
 */
export async function createIssueAlert(title: string, body: string): Promise<AlertResult> {
	const token = providerToken();
	if (token === '') {
		return { channel: 'issue', sent: false, detail: 'GITHUB_TOKEN não está configurado.' };
	}

	const remote = await getRemote();
	if (!remote) {
		return { channel: 'issue', sent: false, detail: 'Nenhum remoto `origin` configurado.' };
	}

	if (remote.host !== 'github.com') {
		return { channel: 'issue', sent: false, detail: `Criação de issue não implementada para ${remote.host}.` };
	}

	try {
		const response = await fetch(`https://api.github.com/repos/${remote.owner}/${remote.repo}/issues`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/vnd.github+json',
				'content-type': 'application/json',
			},
			body: JSON.stringify({ title, body, labels: ['documentação', 'slo'] }),
		});

		if (!response.ok) {
			return { channel: 'issue', sent: false, detail: `O provedor respondeu ${response.status}.` };
		}

		const created = (await response.json()) as { number?: number; html_url?: string };
		return {
			channel: 'issue',
			sent: true,
			detail: created.html_url ?? `Issue #${created.number ?? '?'} criada.`,
		};
	} catch (error) {
		return { channel: 'issue', sent: false, detail: `Falha ao criar a issue: ${(error as Error).message}` };
	}
}
