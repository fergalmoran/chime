import { Laptop, Lock, MessageSquare, Smartphone, Zap } from "lucide-react";
import { ChimeLogo } from "#/components/chime-logo";
import { SignInButton } from "#/components/sign-in-button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";

const features = [
	{
		icon: MessageSquare,
		title: "Every message, one place",
		description:
			"WhatsApp, SMS, email and more - mirrored from your phone the moment they arrive.",
	},
	{
		icon: Zap,
		title: "Real-time",
		description:
			"Notifications are pushed to your browser instantly over a live connection.",
	},
	{
		icon: Lock,
		title: "You're in control",
		description:
			"Mute noisy apps, hide message bodies and choose how long anything is kept.",
	},
];

export function LandingPage() {
	return (
		<main>
			<section className="mx-auto max-w-5xl px-4 py-20 text-center">
				<div className="mx-auto mb-6 flex w-fit items-center gap-3 text-muted-foreground">
					<Smartphone className="size-6" />
					<ChimeLogo className="size-9" />
					<Laptop className="size-6" />
				</div>
				<h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
					Your phone's notifications, on your desktop.
				</h1>
				<p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
					Chime quietly listens for notifications on your Android phone and
					syncs them to your browser, so you can stay focused without reaching
					for your pocket.
				</p>
				<div className="mt-10 flex justify-center gap-3">
					<SignInButton size="lg" />
				</div>
			</section>

			<section className="mx-auto grid max-w-5xl gap-4 px-4 pb-24 sm:grid-cols-3">
				{features.map(({ icon: Icon, title, description }) => (
					<Card key={title}>
						<CardHeader>
							<Icon className="mb-2 size-6 text-primary" />
							<CardTitle>{title}</CardTitle>
							<CardDescription>{description}</CardDescription>
						</CardHeader>
					</Card>
				))}
			</section>
		</main>
	);
}
