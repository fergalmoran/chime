import { expect, test } from "bun:test";
import { groupConversations, parseTitle } from "../lib/conversations.ts";

const n = (id, title, body, postedAt, appId = "com.whatsapp") => ({
	id, appId, appName: "WhatsApp", category: "Message", title, body, postedAt, receivedAt: postedAt,
});

test("parseTitle splits group chat titles into conversation and sender", () => {
	expect(parseTitle("AdEdFerg: Adam Dunbar")).toEqual({ conversation: "AdEdFerg", sender: "Adam Dunbar" });
	expect(parseTitle("Emer Moran")).toEqual({ conversation: "Emer Moran", sender: null });
	expect(parseTitle(null)).toEqual({ conversation: "Unknown", sender: null });
	expect(parseTitle(": odd")).toEqual({ conversation: ": odd", sender: null });
});

test("groupConversations threads messages oldest first and orders conversations by latest activity", () => {
	const result = groupConversations([
		n("3", "Moran 3: Emer Moran", "Emer Moran: Oh wow", "2026-11-10T23:30:00Z"),
		n("2", "AdEdFerg: Adam Dunbar", "Adam Dunbar: link", "2026-11-10T23:26:00Z"),
		n("1", "AdEdFerg: Fergal", "first", "2026-11-10T23:00:00Z"),
	]);
	expect(result.map((c) => c.name)).toEqual(["Moran 3", "AdEdFerg"]);
	expect(result[1].messages).toEqual([
		{ id: "1", sender: "Fergal", text: "first", postedAt: "2026-11-10T23:00:00Z" },
		{ id: "2", sender: "Adam Dunbar", text: "link", postedAt: "2026-11-10T23:26:00Z" },
	]);
	expect(result[0].messages[0].text).toBe("Oh wow");
});

test("groupConversations keeps same-named conversations from different apps apart", () => {
	const result = groupConversations([
		n("1", "Emer", "hi", "2026-11-10T10:00:00Z", "com.whatsapp"),
		n("2", "Emer", "hey", "2026-11-10T11:00:00Z", "com.google.android.apps.messaging"),
	]);
	expect(result).toHaveLength(2);
});
