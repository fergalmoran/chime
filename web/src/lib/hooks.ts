import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import {
	API_URL,
	authStore,
	getAccessToken,
	type NotificationPage,
	type SyncedNotification,
} from "./api";
import { showDesktopNotification } from "./desktop-notifications";

export function useIsAuthenticated() {
	return useSyncExternalStore(
		authStore.subscribe,
		authStore.isAuthenticated,
		() => false,
	);
}

export const notificationsKey = ["notifications"] as const;

/** Keeps the notifications query in sync with the API's real-time hub. */
export function useLiveNotifications() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const connection = new HubConnectionBuilder()
			.withUrl(`${API_URL}/hubs/notifications`, {
				accessTokenFactory: async () => (await getAccessToken()) ?? "",
			})
			.withAutomaticReconnect()
			.configureLogging(LogLevel.Warning)
			.build();

		const update = (
			fn: (items: SyncedNotification[]) => SyncedNotification[],
		) =>
			queryClient.setQueryData<NotificationPage>(notificationsKey, (page) =>
				page ? { ...page, items: fn(page.items) } : page,
			);

		// Handlers must not return a value, or SignalR treats it as a client result.
		connection.on("NotificationReceived", (n: SyncedNotification) => {
			update((items) => [n, ...items.filter((i) => i.id !== n.id)]);
			showDesktopNotification(n);
		});
		connection.on("NotificationDismissed", (id: string) => {
			update((items) => items.filter((i) => i.id !== id));
		});

		const started = connection
			.start()
			.catch((err) => console.warn("Live updates unavailable", err));
		return () => {
			// Stopping mid-negotiation (e.g. StrictMode's double mount) logs spurious errors.
			void started.finally(() => connection.stop());
		};
	}, [queryClient]);
}
