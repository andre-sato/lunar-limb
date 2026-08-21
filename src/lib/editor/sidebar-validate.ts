/**
 * Validação da navegação — a parte pura (issue #11, opção A).
 *
 * Separada de `sidebar.ts` porque o componente do editor precisa dela: importar
 * o outro módulo traria `node:fs` para o bundle do navegador.
 *
 * A separação também garante o que importa: **cliente e servidor rodam a mesma
 * função**. Uma validação duplicada no formulário divergiria da do servidor, e
 * a versão mais frouxa é a que decidiria o que o usuário vê — até o `PUT`
 * recusar, sem explicação que ele pudesse antecipar.
 */

/** O diretório que esta tela organiza. Fora dele, a navegação segue automática. */
export const MANAGED_PREFIX = 'guides';

export interface SidebarGroup {
	label: { 'pt-BR': string; en: string; es: string };
	collapsed: boolean;
	/** Slugs sem extensão: `guides/sdk`. */
	items: string[];
}

export interface SidebarConfig {
	guides: SidebarGroup[];
}

export interface SidebarIssue {
	code:
		| 'SB-UNKNOWN-SLUG'
		| 'SB-DUPLICATE'
		| 'SB-ORPHAN'
		| 'SB-EMPTY-GROUP'
		| 'SB-MISSING-LABEL'
		| 'SB-LARGE-GROUP';
	message: string;
	severity: 'error' | 'warning';
}

export interface SidebarValidation {
	valid: boolean;
	issues: SidebarIssue[];
	/** Páginas que existem e não estão em grupo nenhum. */
	orphans: string[];
}


const MAX_COMFORTABLE_GROUP = 8;

/**
 * Confere a navegação proposta contra as páginas que existem.
 *
 * Erro impede salvar; aviso não. A régua é a mesma do resto do portal: bloqueia
 * o que quebra o build ou some com uma página, avisa o resto.
 */
export function validateSidebar(
	config: SidebarConfig,
	available: readonly string[],
	hidden: ReadonlySet<string> = new Set()
): SidebarValidation {
	const issues: SidebarIssue[] = [];
	const known = new Set(available);

	const seen = new Map<string, number>();
	for (const group of config.guides) {
		for (const slug of group.items) seen.set(slug, (seen.get(slug) ?? 0) + 1);
	}

	for (const [slug, count] of seen) {
		if (!known.has(slug)) {
			issues.push({
				code: 'SB-UNKNOWN-SLUG',
				severity: 'error',
				message: `\`${slug}\` não corresponde a nenhuma página. A Starlight recusa um slug inexistente e o build inteiro para.`,
			});
		}
		if (count > 1) {
			issues.push({
				code: 'SB-DUPLICATE',
				severity: 'error',
				message: `\`${slug}\` aparece ${count} vezes. A mesma página em dois grupos ensina que a navegação não tem um lugar certo para cada coisa.`,
			});
		}
	}

	const orphans = available.filter((slug) => !seen.has(slug) && !hidden.has(slug));
	for (const slug of orphans) {
		issues.push({
			code: 'SB-ORPHAN',
			severity: 'error',
			// Erro, e não aviso: a página continua publicada e acessível por URL,
			// mas sai da navegação sem ninguém decidir isso. Quem quer uma página
			// fora da barra declara `visible: false` — aí ela não é órfã.
			message: `\`${slug}\` não está em grupo nenhum. Ela sairia da navegação sem declarar \`visible: false\`.`,
		});
	}

	config.guides.forEach((group, index) => {
		const name = group.label?.['pt-BR'] || `grupo ${index + 1}`;

		if (!group.label?.['pt-BR'] || !group.label.en || !group.label.es) {
			issues.push({
				code: 'SB-MISSING-LABEL',
				severity: 'error',
				message: `O ${name} não tem rótulo nos três idiomas.`,
			});
		}

		if (group.items.length === 0) {
			issues.push({
				code: 'SB-EMPTY-GROUP',
				severity: 'error',
				message: `O grupo "${name}" está vazio. Um cabeçalho que não abre nada é ruído.`,
			});
		} else if (group.items.length > MAX_COMFORTABLE_GROUP) {
			issues.push({
				code: 'SB-LARGE-GROUP',
				severity: 'warning',
				message: `"${name}" tem ${group.items.length} itens. Acima de ${MAX_COMFORTABLE_GROUP}, varrer com o olho vira ler.`,
			});
		}
	});

	return { valid: !issues.some((issue) => issue.severity === 'error'), issues, orphans };
}


/**
 * Normaliza o que chegou da rede antes de qualquer coisa.
 *
 * O corpo vem de um cliente, e gravar o objeto recebido deixaria a forma do
 * arquivo à mercê de quem o enviou. Reconstruir campo a campo é o que garante
 * que só as chaves conhecidas cheguem ao disco.
 */
export function normalizeSidebar(input: unknown): SidebarConfig {
	const groups = (input as SidebarConfig | undefined)?.guides;
	if (!Array.isArray(groups)) throw new Error('Corpo sem a lista `guides`.');

	return {
		guides: groups.map((group) => {
			const label = (group?.label ?? {}) as Record<string, unknown>;
			const text = (key: string) => (typeof label[key] === 'string' ? (label[key] as string).trim() : '');

			return {
				label: { 'pt-BR': text('pt-BR'), en: text('en'), es: text('es') },
				collapsed: group?.collapsed !== false,
				items: Array.isArray(group?.items)
					? group.items.filter((slug: unknown): slug is string => typeof slug === 'string')
					: [],
			};
		}),
	};
}
