import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Broader root than content-fs.ts on purpose: images referenced from a doc
 * commonly live outside src/content/docs (e.g. src/assets/), so this is
 * scoped to the whole src/ tree instead — still fully contained and
 * traversal-protected, just not limited to the docs collection.
 */
const SRC_ROOT = path.join(process.cwd(), 'src');

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
};

export class AssetFsError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

export function resolveSafeAssetPath(relativePath: string): string {
	if (!relativePath || typeof relativePath !== 'string') {
		throw new AssetFsError('Caminho inválido.', 400);
	}
	const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const resolved = path.resolve(SRC_ROOT, cleaned);
	const rootWithSep = SRC_ROOT.endsWith(path.sep) ? SRC_ROOT : SRC_ROOT + path.sep;

	if (resolved !== SRC_ROOT && !resolved.startsWith(rootWithSep)) {
		throw new AssetFsError('Caminho fora da área permitida.', 403);
	}
	return resolved;
}

export async function readAsset(relativePath: string): Promise<{ buffer: Buffer; mime: string }> {
	const abs = resolveSafeAssetPath(relativePath);
	const ext = path.extname(abs).toLowerCase();
	const mime = MIME_TYPES[ext];
	if (!mime) {
		throw new AssetFsError('Tipo de arquivo não suportado no preview.', 400);
	}

	try {
		await stat(abs);
	} catch {
		throw new AssetFsError('Arquivo não encontrado.', 404);
	}

	const buffer = await readFile(abs);
	return { buffer, mime };
}
