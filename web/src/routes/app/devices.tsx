import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Globe, Smartphone, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { api } from "#/lib/api";

export const Route = createFileRoute("/app/devices")({
	component: DevicesPage,
});

function DevicesPage() {
	const queryClient = useQueryClient();
	const { data, isPending, isError } = useQuery({
		queryKey: ["devices"],
		queryFn: api.devices,
	});
	const remove = useMutation({
		mutationFn: api.deleteDevice,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
	});

	if (isPending) return <p className="text-muted-foreground">Loading…</p>;
	if (isError)
		return <p className="text-destructive">Couldn't load devices.</p>;
	if (data.length === 0) {
		return (
			<p className="py-12 text-center text-muted-foreground">
				No devices yet. Sign in from the Android app or browser extension to
				register one.
			</p>
		);
	}

	return (
		<ul className="grid gap-3">
			{data.map((d) => {
				const Icon = d.platform === "Android" ? Smartphone : Globe;
				return (
					<li key={d.id}>
						<Card className="py-4">
							<CardContent className="flex items-center gap-3">
								<Icon className="size-5 text-muted-foreground" />
								<div className="flex-1">
									<p className="font-medium">{d.name}</p>
									<p className="text-xs text-muted-foreground">
										{d.platform} · last seen{" "}
										{d.lastSeenAt
											? new Date(d.lastSeenAt).toLocaleString()
											: "never"}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Remove ${d.name}`}
									onClick={() => {
										if (confirm(`Remove ${d.name}?`)) remove.mutate(d.id);
									}}
								>
									<Trash2 />
								</Button>
							</CardContent>
						</Card>
					</li>
				);
			})}
		</ul>
	);
}
