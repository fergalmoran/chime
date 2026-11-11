import { cn } from 'cn';

/** The Chime brand mark (media/branding/chime.svg), coloured by the --logo-* theme tokens, as on the web app. */
export function ChimeLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" role="img" aria-label="Chime" className={cn('size-6', className)}>
      <g transform="translate(256 256) scale(1.58) translate(-256 -256)">
        <path d="M124 224a136 136 0 0 1 226-67" className="stroke-logo-arc-a" strokeWidth="32" strokeLinecap="round" />
        <path d="m360 115 6 65-65-6" className="fill-logo-arc-a stroke-logo-arc-a" strokeWidth="12" strokeLinejoin="round" />
        <path d="M388 288a136 136 0 0 1-226 67" className="stroke-logo-arc-b" strokeWidth="32" strokeLinecap="round" />
        <path d="m152 397-6-65 65 6" className="fill-logo-arc-b stroke-logo-arc-b" strokeWidth="12" strokeLinejoin="round" />
        <path
          d="M256 174c-32 0-54 24-54 56v30c0 15-7 27-17 38-5 6-1 14 7 14h128c8 0 12-8 7-14-10-11-17-23-17-38v-30c0-32-22-56-54-56Z"
          className="fill-logo-bell"
        />
        <path d="M237 328a19 19 0 0 0 38 0" className="fill-logo-bell" />
      </g>
    </svg>
  );
}
