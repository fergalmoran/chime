import { createFileRoute, Link } from "@tanstack/react-router";

const CONTACT_EMAIL = "chime@podnoms.com";
const LAST_UPDATED = "7 November 2026";

export const Route = createFileRoute("/privacy")({
	head: () => ({
		meta: [
			{ title: "Privacy policy — Chime" },
			{
				name: "description",
				content:
					"What Chime collects, why, how long it's kept and how to delete it.",
			},
		],
	}),
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<main className="mx-auto max-w-3xl px-4 py-12">
			<article className="prose prose-neutral dark:prose-invert max-w-none">
				<h1>Privacy policy</h1>
				<p className="lead">Last updated: {LAST_UPDATED}</p>

				<p>
					Chime forwards notifications from your Android phone to your browser.
					To do that it has to handle some of your data. This page explains what
					Chime collects, why, how long it keeps it, and how to remove it. It
					covers the Chime website, the Android app and the browser extension.
				</p>
				<p>
					In short: Chime keeps only what it needs to sync your notifications,
					deletes them automatically on a schedule you choose, and never sells
					your data or uses it for advertising.
				</p>

				<h2>What Chime collects</h2>

				<h3>Your account</h3>
				<p>
					You sign in with Google. Chime receives and stores your email address
					and your Google account identifier, plus the date your account was
					created. Chime never sees your Google password.
				</p>

				<h3>Notifications</h3>
				<p>
					When you grant notification access on your phone, the Android app
					sends the notifications you have chosen to sync to Chime's server. For
					each one Chime stores:
				</p>
				<ul>
					<li>the app it came from (its name and package name);</li>
					<li>its category (message, SMS, email, call or other);</li>
					<li>
						its title and text. The title often includes the sender's name. You
						can turn off message text in Settings, and Chime will then store the
						title only;
					</li>
					<li>
						when it was posted and received, and whether you dismissed it.
					</li>
				</ul>
				<p>
					You decide what is synced: you can pause syncing, choose which
					categories to include, and mute individual apps. Notifications from
					muted apps or disabled categories are not stored.
				</p>
				<p>
					Notifications can contain information about other people, such as the
					names and messages of people who contact you. Chime processes that
					only to show it to you.
				</p>

				<h3>Devices</h3>
				<p>
					For each phone, browser or extension you sign in on, Chime stores a
					device name, its type, when it was added and when it was last seen.
					For Android phones it also stores a push token, which lets your
					desktop send links to that phone.
				</p>

				<h3>Links sent to your phone</h3>
				<p>
					When you send a link from your desktop to your phone, the link and its
					title are passed to Google's Firebase Cloud Messaging service for
					delivery. Chime does not store them.
				</p>

				<h3>Settings</h3>
				<p>
					Chime stores your preferences: whether sync is on, whether message
					text is included, your retention period, muted apps and enabled
					categories.
				</p>

				<h3>On your own devices</h3>
				<p>
					The website and extension keep your sign-in tokens and display
					preferences (such as light or dark theme) in your browser's local
					storage. Chime does not use advertising or tracking cookies.
				</p>

				<h3>Server logs</h3>
				<p>
					Like most web services, Chime's server may log technical details such
					as IP addresses, request times and errors. These are used to keep the
					service secure and working, and are not used to profile you.
				</p>

				<h2>How long data is kept</h2>
				<ul>
					<li>
						<strong>Notifications</strong> are deleted automatically once they
						are older than your retention period. It is 7 days by default and
						can be set from 1 to 365 days in Settings. You can also delete any
						notification yourself at any time.
					</li>
					<li>
						<strong>Devices</strong> stay until you remove them on the Devices
						page.
					</li>
					<li>
						<strong>Your account and settings</strong> stay until you delete
						your account. Deleting it removes everything listed above from
						Chime's server straight away.
					</li>
				</ul>

				<h2>Services Chime relies on</h2>
				<ul>
					<li>
						<strong>Google Sign-In</strong> verifies who you are.
					</li>
					<li>
						<strong>Firebase Cloud Messaging</strong> (Google) delivers links to
						your phone.
					</li>
					<li>
						<strong>Google Analytics for Firebase</strong> is included in the
						Android app and may collect anonymous app usage and device
						information.
					</li>
				</ul>
				<p>
					These services handle data under{" "}
					<a href="https://policies.google.com/privacy">
						Google's privacy policy
					</a>
					. Chime's own server is run independently and does not share your
					notifications with anyone.
				</p>

				<h2>Security</h2>
				<p>
					All traffic between your devices and Chime is encrypted with HTTPS.
					Your data is only available to your own signed-in devices. No system
					is perfectly secure, so think about which apps you sync. For example,
					you could mute your banking app or turn off message text.
				</p>

				<h2>Your choices and rights</h2>
				<p>You can:</p>
				<ul>
					<li>pause syncing, mute apps or hide message text in Settings;</li>
					<li>delete individual notifications from your feed;</li>
					<li>remove devices on the Devices page;</li>
					<li>
						delete your account and all its data at any time from Settings →
						Delete account. Every device signed in to it is signed out;
					</li>
					<li>
						revoke notification access on your phone, or uninstall the app or
						extension, at any time.
					</li>
				</ul>
				<p>
					To get a copy of your data, or if you can no longer sign in and want
					your account deleted, email{" "}
					<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the
					address you sign in with. Depending on where you live (for example in
					the EU or UK), you may also have the right to correct or restrict how
					your data is used, and to complain to your data protection authority.
				</p>

				<h2>Children</h2>
				<p>
					Chime is not intended for children under 13, and does not knowingly
					collect data from them.
				</p>

				<h2>Changes</h2>
				<p>
					If this policy changes, the new version will be posted here with a new
					"Last updated" date. Significant changes will also be announced in the
					app or on the website.
				</p>

				<h2>Contact</h2>
				<p>
					Questions about privacy:{" "}
					<a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
				</p>

				<p>
					<Link to="/">← Back to Chime</Link>
				</p>
			</article>
		</main>
	);
}
