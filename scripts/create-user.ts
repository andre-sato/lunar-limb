/**
 * Cria um usuário do portal pela linha de comando.
 *
 *   npm run user:create -- --email mestre@exemplo.com --name "Mestre" --role admin
 *   npm run user:create -- --email leitor@exemplo.com --role viewer
 *
 * Sem `--password`, uma senha forte é gerada e impressa **uma única vez**; o
 * usuário entra com ela e o portal exige a troca no primeiro acesso. É de
 * propósito que não haja uma opção para reimprimir: a senha existe no console
 * uma vez e depois só existe como hash.
 *
 * Por que um CLI e não só a tela de Settings: para criar o primeiro usuário com
 * acesso administrativo é preciso já ter acesso administrativo. Quem tem o
 * sistema de arquivos do servidor já tem controle total, então este caminho não
 * concede nada que não estivesse concedido — só evita o impasse.
 *
 * Códigos de saída: 0 criado · 1 uso inválido · 2 falha ao criar.
 */

import { createUser, listUsers } from '../src/lib/auth/users';
import { ROLES, type Role } from '../src/lib/auth/permissions';
import type { AuthUser } from '../src/lib/auth/permissions';

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_FAILED = 2;

interface Args {
	email?: string;
	name?: string;
	role?: string;
	password?: string;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag.startsWith('--') || value === undefined) continue;
		const key = flag.slice(2);
		if (key === 'email' || key === 'name' || key === 'role' || key === 'password') {
			args[key] = value;
			index++;
		}
	}
	return args;
}

function usage(message: string): never {
	console.error(`\n${message}\n`);
	console.error('Uso:');
	console.error('  npm run user:create -- --email <e-mail> [--name <nome>] [--role viewer|editor|admin]');
	console.error('');
	console.error('Sem --password, a senha é gerada e mostrada uma única vez.');
	console.error('Prefira não passar --password na linha de comando: ela fica no histórico do shell.');
	console.error('');
	process.exit(EXIT_USAGE);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!args.email) usage('Informe --email.');

	const role = (args.role ?? 'admin') as Role;
	if (!ROLES.includes(role)) {
		usage(`Papel desconhecido: ${args.role}. Use um de: ${ROLES.join(', ')}.`);
	}

	// Ator do CLI. O `id` real de um admin existente é preferido para a
	// auditoria apontar para alguém; sem nenhum, o registro fica como `cli`,
	// que é honesto sobre a origem da ação.
	const existing = await listUsers();
	const firstAdmin = existing.find((user) => user.role === 'admin' && user.status === 'active');

	const actor: AuthUser = {
		id: firstAdmin?.id ?? 'cli',
		role: 'admin',
		status: 'active',
	};

	try {
		const { user, generatedPassword } = await createUser(
			{
				email: args.email,
				name: args.name ?? args.email.split('@')[0],
				role,
				password: args.password,
			},
			actor
		);

		const line = '─'.repeat(64);
		console.info('');
		console.info(line);
		console.info(' Usuário criado');
		console.info('');
		console.info(`   Nome:   ${user.name}`);
		console.info(`   E-mail: ${user.email}`);
		console.info(`   Papel:  ${user.role}`);
		if (generatedPassword) {
			console.info(`   Senha:  ${generatedPassword}`);
			console.info('');
			console.info(' Esta senha aparece uma única vez e deve ser trocada no');
			console.info(' primeiro acesso. Ela não fica no repositório nem na interface.');
		}
		console.info(line);
		console.info('');

		process.exit(EXIT_OK);
	} catch (error) {
		console.error(`\nNão foi possível criar o usuário: ${error instanceof Error ? error.message : error}\n`);
		process.exit(EXIT_FAILED);
	}
}

void main();
