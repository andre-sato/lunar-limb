import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a debounced version of `callback`, plus a `flush` function that
 * cancels any pending timer and invokes the latest callback immediately
 * (used by manual Save / Cmd+S).
 */
export function useDebouncedCallback<Args extends unknown[]>(
	callback: (...args: Args) => void,
	delayMs: number
): { run: (...args: Args) => void; flush: (...args: Args) => void; cancel: () => void } {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	const cancel = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const run = useCallback(
		(...args: Args) => {
			cancel();
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				callbackRef.current(...args);
			}, delayMs);
		},
		[cancel, delayMs]
	);

	const flush = useCallback(
		(...args: Args) => {
			cancel();
			callbackRef.current(...args);
		},
		[cancel]
	);

	useEffect(() => cancel, [cancel]);

	return { run, flush, cancel };
}
