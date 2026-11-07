import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "chime-theme";

/**
 * Runs inline in <head> before first paint so the page never flashes the
 * wrong theme. With no saved choice it follows the OS setting.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function readTheme(): Theme {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
	const theme = useSyncExternalStore<Theme>(
		subscribe,
		readTheme,
		() => "light",
	);

	const toggleTheme = useCallback(() => {
		const next: Theme = readTheme() === "dark" ? "light" : "dark";
		document.documentElement.classList.toggle("dark", next === "dark");
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// storage unavailable: still applies for this page view
		}
		for (const l of listeners) l();
	}, []);

	return { theme, toggleTheme };
}
