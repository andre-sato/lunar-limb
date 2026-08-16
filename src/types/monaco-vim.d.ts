/**
 * `monaco-vim` não publica tipos. A superfície que o editor usa é só
 * `initVimMode`, então declaramos exatamente isso em vez de puxar `any`
 * para dentro do MarkdownEditorPane.
 */
declare module 'monaco-vim' {
	export function initVimMode(editor: unknown, statusBarNode?: HTMLElement | null): { dispose: () => void };
}
