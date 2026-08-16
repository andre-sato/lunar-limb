import { isConditionMet, isKnownVariable, type VariableMap } from '../content/variables';

/**
 * Fase 5 — contraparte de `src/components/content/If.astro` para o preview.
 *
 * Diferença deliberada em relação ao site publicado: lá, um trecho oculto
 * simplesmente **não vai para o HTML**. Aqui, ele vira um marcador visível
 * ("trecho oculto — flag `beta` desligada"), porque quem está escrevendo
 * precisa enxergar que existe conteúdo condicional ali. Sumir sem deixar
 * rastro seria péssimo para autoria.
 */

// Tipagem frouxa proposital: as formas de nó do mdast-util-mdx-jsx variam entre
// versões e este módulo só lê alguns campos conhecidos.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ConditionalIssue {
	flag: string;
	reason: 'unknown-variable';
}

function attributeValue(node: any, name: string): string | boolean | null | undefined {
	const attr = (node.attributes || []).find((a: any) => a.type === 'mdxJsxAttribute' && a.name === name);
	if (!attr) return undefined;
	// `<If not>` (atributo sem valor) chega como value: null.
	if (attr.value === null) return true;
	if (typeof attr.value === 'string') return attr.value;
	return undefined;
}

function matchConditional(node: any): { flag: string; equals?: string; not: boolean } | null {
	if (node?.type !== 'mdxJsxFlowElement' && node?.type !== 'mdxJsxTextElement') return null;
	if (node.name !== 'If') return null;

	const flag = attributeValue(node, 'flag');
	if (typeof flag !== 'string' || flag.trim() === '') return null;

	const equals = attributeValue(node, 'equals');
	const not = attributeValue(node, 'not');

	return {
		flag: flag.trim(),
		equals: typeof equals === 'string' ? equals : undefined,
		not: not === true || not === 'true',
	};
}

function describe(condition: { flag: string; equals?: string; not: boolean }): string {
	if (condition.equals !== undefined) {
		return `${condition.flag} ${condition.not ? '≠' : '='} "${condition.equals}"`;
	}
	return condition.not ? `${condition.flag} desligada` : `${condition.flag} ligada`;
}

function hiddenMarker(condition: { flag: string; equals?: string; not: boolean }, known: boolean): any {
	const label = known
		? `Trecho oculto — condição não satisfeita: ${describe(condition)}`
		: `Trecho oculto — variável "${condition.flag}" não existe`;

	return {
		type: 'paragraph',
		data: { hProperties: { className: ['conditional-hidden'] } },
		children: [{ type: 'text', value: label }],
	};
}

function visibleWrapper(condition: { flag: string; equals?: string; not: boolean }, children: any[]): any {
	return {
		type: 'blockquote',
		data: { hProperties: { className: ['conditional-visible'], 'data-condition': describe(condition) } },
		children,
	};
}

function walk(node: any, variables: VariableMap, issues: ConditionalIssue[]): void {
	if (!node || !Array.isArray(node.children)) return;

	for (let i = 0; i < node.children.length; i++) {
		const child = node.children[i];
		const condition = matchConditional(child);

		if (!condition) {
			walk(child, variables, issues);
			continue;
		}

		const known = isKnownVariable(variables, condition.flag);
		if (!known) {
			issues.push({ flag: condition.flag, reason: 'unknown-variable' });
		}

		// Resolve o que estiver dentro antes de decidir o destino do bloco.
		walk(child, variables, issues);

		if (isConditionMet(variables, condition)) {
			node.children[i] = visibleWrapper(condition, child.children ?? []);
		} else {
			node.children[i] = hiddenMarker(condition, known);
		}
	}
}

export function remarkResolveConditionals(variables: VariableMap) {
	return (tree: any, file: any) => {
		const issues: ConditionalIssue[] = [];
		walk(tree, variables, issues);
		file.data.conditionalIssues = issues;
	};
}
