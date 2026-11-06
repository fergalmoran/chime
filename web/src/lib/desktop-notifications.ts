import type { SyncedNotification } from "./api";

export const DESKTOP_NOTIFICATIONS_KEY = "chime.desktopNotifications";

export function desktopNotificationsSupported() {
	return (
		typeof window !== "undefined" &&
		window.isSecureContext &&
		"Notification" in window
	);
}

export function showDesktopNotification(notification: SyncedNotification) {
	if (
		!desktopNotificationsSupported() ||
		Notification.permission !== "granted" ||
		localStorage.getItem(DESKTOP_NOTIFICATIONS_KEY) !== "true"
	) {
		return;
	}

	try {
		const toast = new Notification(
			notification.title || notification.appName || notification.appId,
			{
				body: notification.body ?? "",
				tag: `chime:${notification.id}`,
			},
		);
		toast.onclick = () => {
			window.focus();
			window.location.assign("/app");
			toast.close();
		};
		toast.onerror = () =>
			console.warn("Desktop notification could not be displayed");
	} catch (error) {
		console.warn("Desktop notification could not be displayed", error);
	}
}
