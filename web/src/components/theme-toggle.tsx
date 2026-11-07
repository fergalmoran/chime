import { Moon, Sun } from "lucide-react";
import { Button } from "#/components/ui/button";
import { useTheme } from "#/lib/theme";

export function ThemeToggle() {
	const { theme, toggleTheme } = useTheme();
	const label =
		theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

	return (
		<Button
			variant="ghost"
			size="icon"
			onClick={toggleTheme}
			aria-label={label}
			title={label}
		>
			{/* Icons switch on the .dark class, so they're right before hydration too */}
			<Sun className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
			<Moon className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
		</Button>
	);
}
