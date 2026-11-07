import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
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
import {
	ALL_CATEGORIES,
	api,
	authStore,
	describeError,
	type Settings,
} from "#/lib/api";

export const Route = createFileRoute("/_app/settings")({
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
	return (
		<div className="grid gap-6">
			<SettingsForm initial={data} />
			<DeleteAccount />
		</div>
	);
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

function DeleteAccount() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const me = useQuery({ queryKey: ["me"], queryFn: api.me });
	const [confirmation, setConfirmation] = useState("");
	const card = useRef<HTMLDivElement>(null);
	const hash = useLocation({ select: (l) => l.hash });

	// The footer links to /settings#delete-account, but this card only renders once settings have
	// loaded, after the router's own hash scroll has already run.
	useEffect(() => {
		if (hash !== "delete-account") return;
		card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
		card.current?.querySelector("input")?.focus({ preventScroll: true });
	}, [hash]);
	const remove = useMutation({
		mutationFn: api.deleteAccount,
		onSuccess: () => {
			authStore.logout();
			queryClient.clear();
			navigate({ to: "/" });
		},
	});

	const email = me.data?.email;
	const confirmed =
		!!email && confirmation.trim().toLowerCase() === email.toLowerCase();

	return (
		<Card
			id="delete-account"
			ref={card}
			className="scroll-mt-20 border-destructive/50"
		>
			<CardHeader>
				<CardTitle>Delete account</CardTitle>
				<CardDescription>
					Permanently deletes your account, synced notifications, devices and
					settings. Every phone, browser and extension signed in to it will be
					signed out. This can't be undone.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (confirmed) remove.mutate();
					}}
				>
					<Label htmlFor="delete-confirm" className="font-normal">
						To confirm, type your email address
						{email && (
							<>
								{" "}
								<span className="font-medium">{email}</span>
							</>
						)}
					</Label>
					<Input
						id="delete-confirm"
						autoComplete="off"
						className="max-w-sm"
						value={confirmation}
						onChange={(e) => setConfirmation(e.target.value)}
					/>
					<div className="flex items-center gap-3">
						<Button
							type="submit"
							variant="destructive"
							disabled={!confirmed || remove.isPending}
						>
							{remove.isPending ? "Deleting…" : "Delete my account"}
						</Button>
						{remove.isError && (
							<span className="text-sm text-destructive">
								{describeError(remove.error)}
							</span>
						)}
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
