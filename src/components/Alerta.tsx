import type { ReactNode } from 'react';

// Callout box for use inside MDX pages. Colors come from Starlight's own
// aside palette, so it follows the active light/dark theme without extra CSS.
export type TipoAlerta = 'nota' | 'dica' | 'aviso' | 'perigo';

interface AlertaProps {
	tipo?: TipoAlerta;
	titulo?: string;
	children: ReactNode;
}

const cores: Record<TipoAlerta, string> = {
	nota: 'blue',
	dica: 'purple',
	aviso: 'orange',
	perigo: 'red',
};

const titulos: Record<TipoAlerta, string> = {
	nota: 'Nota',
	dica: 'Dica',
	aviso: 'Atenção',
	perigo: 'Cuidado',
};

export function Alerta({ tipo = 'nota', titulo, children }: AlertaProps) {
	const cor = cores[tipo] ?? cores.nota;
	return (
		<aside
			aria-label={titulo ?? titulos[tipo]}
			style={{
				borderInlineStart: `0.25rem solid var(--sl-color-${cor})`,
				backgroundColor: `var(--sl-color-${cor}-low)`,
				color: 'var(--sl-color-white)',
				padding: '1rem',
				margin: '1rem 0',
				borderRadius: '0.25rem',
			}}
		>
			<p
				style={{
					margin: '0 0 0.5rem',
					fontWeight: 600,
					color: `var(--sl-color-${cor}-high)`,
				}}
			>
				{titulo ?? titulos[tipo]}
			</p>
			<div>{children}</div>
		</aside>
	);
}

export default Alerta;
