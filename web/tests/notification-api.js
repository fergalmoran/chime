// A scriptable browser Notification API (happy-dom doesn't provide one).

/** Installs window.Notification with the given permission; returns the alerts it shows and its requests. */
export function installNotificationApi(permission = "default", { requestResult, throwOnCreate = false, requestError } = {}) {
	const api = { shown: [], requests: 0 };
	class FakeNotification {
		static permission = permission;
		static async requestPermission() {
			api.requests++;
			if (requestError) throw requestError;
			FakeNotification.permission = requestResult ?? FakeNotification.permission;
			return FakeNotification.permission;
		}
		constructor(title, options) {
			if (throwOnCreate) throw new TypeError("Illegal constructor");
			this.title = title;
			this.options = options;
			this.closed = false;
			api.shown.push(this);
		}
		close() {
			this.closed = true;
		}
	}
	api.Notification = FakeNotification;
	window.Notification = FakeNotification;
	globalThis.Notification = FakeNotification;
	return api;
}

export function removeNotificationApi() {
	delete window.Notification;
	delete globalThis.Notification;
}
