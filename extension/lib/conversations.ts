import type { SyncedNotification } from '@/lib/api';

export interface ConversationMessage {
  id: string;
  /** Who sent it, when the notification names someone other than the conversation itself (group chats). */
  sender: string | null;
  text: string;
  postedAt: string;
}

export interface Conversation {
  key: string;
  name: string;
  appName: string;
  /** Oldest first, as a chat thread reads. */
  messages: ConversationMessage[];
  lastPostedAt: string;
}

/**
 * Splits a message notification's title into conversation and sender. Group chats (WhatsApp, Signal, …) title
 * them "Group: Sender"; one-to-one chats and SMS use just the sender's name, which is also the conversation.
 */
export function parseTitle(title: string | null): { conversation: string; sender: string | null } {
  const text = title?.trim() || 'Unknown';
  const split = text.indexOf(': ');
  if (split <= 0) return { conversation: text, sender: null };
  return { conversation: text.slice(0, split), sender: text.slice(split + 2) || null };
}

/** Group chat bodies often repeat the sender ("Adam: hi") even though the title names them already. */
function stripSender(body: string, sender: string | null) {
  return sender && body.startsWith(`${sender}: `) ? body.slice(sender.length + 2) : body;
}

/** Groups message notifications into conversations, most recently active first. */
export function groupConversations(notifications: SyncedNotification[]): Conversation[] {
  const byKey = new Map<string, Conversation>();
  for (const n of notifications) {
    const { conversation, sender } = parseTitle(n.title);
    const key = `${n.appId}\u0000${conversation}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, name: conversation, appName: n.appName ?? n.appId, messages: [], lastPostedAt: n.postedAt };
      byKey.set(key, entry);
    }
    entry.messages.push({ id: n.id, sender, text: stripSender(n.body ?? '', sender), postedAt: n.postedAt });
    if (Date.parse(n.postedAt) > Date.parse(entry.lastPostedAt)) entry.lastPostedAt = n.postedAt;
  }
  const conversations = [...byKey.values()];
  for (const c of conversations) c.messages.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  return conversations.sort((a, b) => Date.parse(b.lastPostedAt) - Date.parse(a.lastPostedAt));
}
