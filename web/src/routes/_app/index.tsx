import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { api } from "#/lib/api";
import { notificationsKey } from "#/lib/hooks";

export const Route = createFileRoute("/_app/")({
	component: NotificationsPage,
});

function NotificationsPage() {
	const { data, isPending, isError } = useQuery({
		queryKey: notificationsKey,
		queryFn: () => api.notifications(),
	});
	const dismiss = useMutation({ mutationFn: api.dismissNotification });

	if (isPending) return <p className="text-muted-foreground">Loading…</p>;
	if (isError)
		return <p className="text-destructive">Couldn't load notifications.</p>;
	if (data.items.length === 0) {
		return (
			<p className="py-12 text-center text-muted-foreground">
				Nothing here yet. Install the Android app and new notifications will
				appear instantly.
			</p>
		);
	}

	return (
		<ul className="grid gap-3">
			{data.items.map((n) => (
				<li key={n.id}>
					<Card className="py-4">
						<CardContent className="flex items-start gap-3">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Badge variant="secondary">{n.appName ?? n.appId}</Badge>
									<time dateTime={n.postedAt}>
										{new Date(n.postedAt).toLocaleString()}
									</time>
								</div>
								{n.title && <p className="mt-2 font-medium">{n.title}</p>}
								{n.body && (
									<p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
										{n.body}
									</p>
								)}
							</div>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Dismiss"
								disabled={dismiss.isPending && dismiss.variables === n.id}
								onClick={() => dismiss.mutate(n.id)}
							>
								<X />
							</Button>
						</CardContent>
					</Card>
				</li>
			))}
		</ul>
	);
}
