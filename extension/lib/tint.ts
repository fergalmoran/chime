/**
 * Theme-token colour sets for tinting an app or contact consistently. Written out in full so Tailwind sees each
 * class name.
 */
const TINTS = [
  { avatar: 'bg-logo-arc-a/20 ring-logo-arc-a', edge: 'border-l-logo-arc-a', dot: 'bg-logo-arc-a' },
  { avatar: 'bg-logo-arc-b/20 ring-logo-arc-b', edge: 'border-l-logo-arc-b', dot: 'bg-logo-arc-b' },
  { avatar: 'bg-primary/20 ring-primary', edge: 'border-l-primary', dot: 'bg-primary' },
  { avatar: 'bg-chart-1/20 ring-chart-1', edge: 'border-l-chart-1', dot: 'bg-chart-1' },
  { avatar: 'bg-chart-2/20 ring-chart-2', edge: 'border-l-chart-2', dot: 'bg-chart-2' },
  { avatar: 'bg-chart-3/20 ring-chart-3', edge: 'border-l-chart-3', dot: 'bg-chart-3' },
] as const;

export type Tint = (typeof TINTS)[number];

/** The same key always gets the same tint. */
export function tintFor(key: string): Tint {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}
