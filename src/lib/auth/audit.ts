/**
 * Registro de auditoria.
 *
 * Cobre tanto as operações administrativas (§33) quanto as de conteúdo (§34),
 * porque a pergunta que interessa depois de um incidente — "quem mudou isso e
 * quando?" — não distingue as duas.
 */

import { randomUUID } from 'node:crypto';
import { readJson, withFileLock, writeJson } from './store';

const FILE = 'audit.json';

/** Limite do arquivo: auditoria não pode crescer sem fim no disco. */
const MAX_EVENTS = 5000;

export type AuditAction =
	| 'USER_CREATED'
	| 'USER_UPDATED'
	| 'USER_ROLE_CHANGED'
	| 'USER_DEACTIVATED'
	| 'USER_REACTIVATED'
	| 'USER_DELETED'
	| 'PERMISSION_CHANGED'
	| 'INTEGRATION_UPDATED'
	| 'SESSION_STARTED'
	| 'SESSION_ENDED'
	| 'SESSION_DENIED'
	| 'DOCUMENT_CREATED'
	| 'DOCUMENT_UPDATED'
	| 'DOCUMENT_DELETED';

export interface AuditEvent {
	id: string;
	actorId: string;
	action: AuditAction;
	targetId?: string;
	timestamp: string;
	metadata?: Record<string, unknown>;
}

export interface RecordAuditInput {
	actorId: string;
	action: AuditAction;
	targetId?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Nunca lança.
 *
 * Uma falha ao gravar auditoria não pode derrubar a operação que a originou:
 * perder o registro de uma desativação é ruim, mas deixar o usuário ativo
 * porque o log falhou é pior.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
	try {
		await withFileLock(FILE, async () => {
			const events = await readJson<AuditEvent[]>(FILE, []);
			events.push({
				id: randomUUID(),
				actorId: input.actorId,
				action: input.action,
				targetId: input.targetId,
				timestamp: new Date().toISOString(),
				metadata: input.metadata,
			});
			const trimmed = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
			await writeJson(FILE, trimmed);
		});
	} catch (error) {
		console.error('[audit] falha ao registrar evento:', (error as Error).message);
	}
}

export interface ListAuditOptions {
	limit?: number;
	action?: AuditAction;
	actorId?: string;
}

/** Mais recentes primeiro — é a ordem em que auditoria é lida. */
export async function listAudit(options: ListAuditOptions = {}): Promise<AuditEvent[]> {
	const events = await readJson<AuditEvent[]>(FILE, []);
	let result = [...events].reverse();

	if (options.action) result = result.filter((event) => event.action === options.action);
	if (options.actorId) result = result.filter((event) => event.actorId === options.actorId);

	const limit = options.limit ?? 100;
	return result.slice(0, limit);
}

export async function lastEventAt(): Promise<string | null> {
	const events = await readJson<AuditEvent[]>(FILE, []);
	return events.length > 0 ? events[events.length - 1].timestamp : null;
}
