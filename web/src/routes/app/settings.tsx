import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import { ALL_CATEGORIES, api, describeError, type Settings } from "#/lib/api";

export const Route = createFileRoute("/app/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	const { data, isPending, isError } = useQuery({
		queryKey: ["settings"],
		queryFn: api.settings,
	});
	if (isPending) return <p className="text-muted-foreground">Loading…</p>;
	if (isError)
		return <p className="text-destructive">Couldn't load settings.</p>;
	return <SettingsForm initial={data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
	const queryClient = useQueryClient();
	const [settings, setSettings] = useState(initial);
	const [mutedApps, setMutedApps] = useState(initial.mutedApps.join("\n"));
	const save = useMutation({
		mutationFn: api.updateSettings,
		onSuccess: (saved) => queryClient.setQueryData(["settings"], saved),
	});

	const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
		setSettings((s) => ({ ...s, [key]: value }));

	const submit = (e: FormEvent) => {
		e.preventDefault();
		save.mutate({
			...settings,
			mutedApps: mutedApps
				.split(/[\n,]/)
				.map((a) => a.trim())
				.filter(Boolean),
		});
	};

	return (
		<form onSubmit={submit} className="grid gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Sync</CardTitle>
					<CardDescription>
						Control what your phone sends to Chime.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-5">
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="sync">Sync notifications</Label>
						<Switch
							id="sync"
							checked={settings.syncEnabled}
							onCheckedChange={(v) => set("syncEnabled", v)}
						/>
					</div>
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="body">Include message contents</Label>
						<Switch
							id="body"
							checked={settings.includeMessageBody}
							onCheckedChange={(v) => set("includeMessageBody", v)}
						/>
					</div>
					<fieldset className="grid gap-2">
						<legend className="mb-2 text-sm font-medium">Categories</legend>
						{ALL_CATEGORIES.map((c) => (
							<div key={c} className="flex items-center gap-2">
								<Checkbox
									id={`cat-${c}`}
									checked={settings.enabledCategories.includes(c)}
									onCheckedChange={(checked) =>
										set(
											"enabledCategories",
											checked
												? [...settings.enabledCategories, c]
												: settings.enabledCategories.filter((x) => x !== c),
										)
									}
								/>
								<Label htmlFor={`cat-${c}`} className="font-normal">
									{c === "Sms" ? "SMS" : c}
								</Label>
							</div>
						))}
					</fieldset>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Privacy</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-5">
					<div className="grid gap-2">
						<Label htmlFor="retention">Keep notifications for (days)</Label>
						<Input
							id="retention"
							type="number"
							min={1}
							max={365}
							className="w-32"
							value={settings.retentionDays}
							onChange={(e) => set("retentionDays", Number(e.target.value))}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="muted">Muted apps</Label>
						<textarea
							id="muted"
							rows={4}
							placeholder="com.example.noisyapp"
							className="rounded-md border bg-transparent px-3 py-2 font-mono text-sm"
							value={mutedApps}
							onChange={(e) => setMutedApps(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							One Android package name per line.
						</p>
					</div>
				</CardContent>
			</Card>

			<div className="flex items-center gap-3">
				<Button type="submit" disabled={save.isPending}>
					{save.isPending ? "Saving…" : "Save settings"}
				</Button>
				{save.isSuccess && (
					<span className="text-sm text-muted-foreground">Saved.</span>
				)}
				{save.isError && (
					<span className="text-sm text-destructive">
						{describeError(save.error)}
					</span>
				)}
			</div>
		</form>
	);
}
