import { Link } from "@tanstack/react-router";

export function SiteFooter() {
	return (
		<footer className="sticky bottom-0 z-10 border-t bg-background/80 backdrop-blur">
			<div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 text-sm text-muted-foreground">
				<span>© {new Date().getFullYear()} Chime</span>
				<Link to="/privacy" className="hover:text-foreground">
					Privacy
				</Link>
			</div>
		</footer>
	);
}
