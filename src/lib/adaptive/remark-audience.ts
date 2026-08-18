/**
 * A diretiva `:::audience{type="developer"}` (§5, §12).
 *
 * O bloco vira um `<details>` com rótulo, marcado com `data-audience`. Quem lê a
 * página escolhe uma audiência e o script do cliente abre os blocos dela e recolhe
 * os demais.
 *
 * **Por que recolher em vez de remover.** A §12 é categórica: personalização não
 * pode remover informação necessária a leitor de tela, quebrar navegação, depender
 * só de aparência nem impedir acesso ao conteúdo completo. Um bloco que sai do
 * HTML viola as quatro. Um `<details>` fechado, não: o conteúdo continua no
 * documento, alcançável por teclado, anunciado como "detalhes" com rótulo dizendo
 * de quem é aquele trecho, e a busca do navegador ainda o encontra.
 *
 * É por isso também que este mecanismo é **diferente** do `<If>` que já existe no
 * portal. Aquele resolve em build e apaga o trecho — que é o certo para conteúdo
 * interno, porque ali o objetivo é justamente não publicar. Aqui o objetivo é o
 * oposto: publicar tudo e mudar só a ênfase.
 */

import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import { AUDIENCE_SHORT, isAudience, type Audience } from './types';

interface DirectiveNode {
	type: string;
	name?: string;
	attributes?: Record<string, string | null | undefined>;
	children?: unknown[];
	data?: {
		hName?: string;
		hProperties?: Record<string, unknown>;
		hChildren?: unknown[];
	};
}

function summaryFor(audience: Audience): string {
	return `Para ${AUDIENCE_SHORT[audience]}`;
}

export function remarkAudience() {
	return (tree: Root) => {
		visit(tree, (node: unknown) => {
			const directive = node as DirectiveNode;
			if (directive.type !== 'containerDirective' && directive.type !== 'leafDirective') return;
			if (directive.name !== 'audience') return;

			const type = directive.attributes?.type ?? directive.attributes?.for;
			if (!isAudience(type)) {
				// Audiência desconhecida: o bloco continua aparecendo, como texto
				// normal. Sumir com o conteúdo por causa de um erro de digitação no
				// atributo seria a pior falha possível para esta camada.
				return;
			}

			directive.data = directive.data ?? {};
			directive.data.hName = 'details';
			directive.data.hProperties = {
				class: 'audience-block',
				'data-audience': type,
				// Aberto na renderização: sem JavaScript, ou antes de ele rodar, a
				// página mostra tudo. A adaptação é uma melhoria progressiva, e o
				// estado inicial precisa ser o mais informativo, não o mais enxuto.
				open: true,
			};

			directive.children = [
				{
					type: 'paragraph',
					data: { hName: 'summary', hProperties: { class: 'audience-block-summary' } },
					children: [{ type: 'text', value: summaryFor(type) }],
				},
				...(directive.children ?? []),
			] as typeof directive.children;
		});
	};
}

export default remarkAudience;
