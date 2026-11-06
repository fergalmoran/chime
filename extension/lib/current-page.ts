import { browser } from 'wxt/browser';

export async function currentPage() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error("Couldn't read the active tab. Reopen the extension from the page you want to send.");
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP and HTTPS web pages without embedded credentials can be sent.');
  }
  if (url.href.length > 2048) throw new Error('This page URL is too long to send (maximum 2,048 characters).');
  return { url: url.href, title: (tab.title || url.hostname).slice(0, 200) };
}
