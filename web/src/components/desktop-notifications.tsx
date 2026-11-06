import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	DESKTOP_NOTIFICATIONS_KEY,
	desktopNotificationsSupported,
} from "#/lib/desktop-notifications";

export function DesktopNotifications() {
	const supported = desktopNotificationsSupported();
	const [permission, setPermission] = useState(
		supported ? Notification.permission : "default",
	);
	const [enabled, setEnabled] = useState(
		() =>
			supported && localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY) === "true",
	);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const refresh = () => {
			if (supported) setPermission(Notification.permission);
			setEnabled(localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY) === "true");
		};
		window.addEventListener("focus", refresh);
		window.addEventListener("storage", refresh);
		return () => {
			window.removeEventListener("focus", refresh);
			window.removeEventListener("storage", refresh);
		};
	}, [supported]);

	const toggle = async () => {
		setError(null);
		try {
			if (enabled && permission === "granted") {
				localStorage.removeItem(DESKTOP_NOTIFICATIONS_KEY);
				setEnabled(false);
				return;
			}
			const result = await Notification.requestPermission();
			setPermission(result);
			if (result === "granted") {
				localStorage.setItem(DESKTOP_NOTIFICATIONS_KEY, "true");
				setEnabled(true);
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Couldn't enable desktop notifications.",
			);
		}
	};

	return (
		<section
			aria-label="Desktop notifications"
			className="mb-6 flex flex-col gap-2"
		>
			<div>
				<Button
					type="button"
					variant="outline"
					disabled={!supported || permission === "denied"}
					onClick={toggle}
				>
					{enabled && permission === "granted"
						? "Disable desktop notifications"
						: "Enable desktop notifications"}
				</Button>
			</div>
			<p className="text-sm text-muted-foreground">
				{!supported
					? "Desktop notifications need a supported browser and HTTPS (or localhost)."
					: permission === "denied"
						? "Notifications are blocked. Allow them in your browser's site settings."
						: "Web alerts work while this dashboard is open. Use the extension for alerts with it closed; enable only one to avoid duplicate alerts."}
			</p>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</section>
	);
}
