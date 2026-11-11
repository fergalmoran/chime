/** A short timestamp: the time for today, "Yesterday", the weekday within a week, else the date. */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (date.getTime() >= startOfToday) return date.toLocaleTimeString([], { timeStyle: 'short' });
  if (date.getTime() >= startOfToday - day) return 'Yesterday';
  if (date.getTime() >= startOfToday - 6 * day) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
