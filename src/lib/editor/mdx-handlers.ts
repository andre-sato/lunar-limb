/**
 * The editor's preview does NOT execute React/Astro components — that would
 * mean running arbitrary project code inside the preview request, which is
 * both heavy and unsafe. Instead, JSX elements are rendered as a labeled
 * box (name + attributes) with their children still rendered normally, so
 * a pattern like:
 *
 *   <Aside type="tip">
 *   Some **markdown** inside.
 *   </Aside>
 *
 * still shows the markdown content, with a small tag indicating which
 * component wraps it. Real component rendering is a later-phase concern
 * (it needs the actual Astro/Starlight render pipeline).
 */

// Loose typing on purpose: the exact mdast-util-mdx-jsx / mdast-util-to-hast
// node & handler shapes vary across versions, and this module only ever
// reads a few well-known fields off them.
/* eslint-disable @typescript-eslint/no-explicit-any */

function attrsToLabel(attributes: any[] | undefined): string {
	if (!attributes || attributes.length === 0) return '';
	return attributes
		.map((attr) => {
			if (attr.type === 'mdxJsxExpressionAttribute') return '{...}';
			if (attr.value === null || attr.value === undefined) return attr.name;
			if (typeof attr.value === 'object') return `${attr.name}={…}`;
			return `${attr.name}="${attr.value}"`;
		})
		.join(' ');
}

function jsxElementHandler(state: any, node: any): any {
	const name = node.name || 'Fragment';
	const attrs = attrsToLabel(node.attributes);
	const label = attrs ? `<${name} ${attrs}>` : `<${name}>`;
	const children = state.all(node);

	return {
		type: 'element',
		tagName: 'div',
		properties: { className: ['mdx-component'] },
		children: [
			{
				type: 'element',
				tagName: 'span',
				properties: { className: ['mdx-component-tag'] },
				children: [{ type: 'text', value: label }],
			},
			...(children.length
				? [
						{
							type: 'element',
							tagName: 'div',
							properties: { className: ['mdx-component-body'] },
							children,
						},
					]
				: []),
		],
	};
}

function expressionHandler(_state: any, node: any): any {
	return {
		type: 'element',
		tagName: 'code',
		properties: { className: ['mdx-expression'] },
		children: [{ type: 'text', value: `{${node.value ?? ''}}` }],
	};
}

// import/export statements at the top of an .mdx file carry no visual
// content for the preview — drop them.
function dropHandler(): any {
	return undefined;
}

export const mdxHandlers: Record<string, any> = {
	mdxJsxFlowElement: jsxElementHandler,
	mdxJsxTextElement: jsxElementHandler,
	mdxFlowExpression: expressionHandler,
	mdxTextExpression: expressionHandler,
	mdxjsEsm: dropHandler,
};
