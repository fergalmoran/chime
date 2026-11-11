import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-muted-foreground">
      <div className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-5">{icon}</div>
      <p className="font-medium text-foreground">{title}</p>
      {children && <p className="text-xs">{children}</p>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {children}
    </p>
  );
}
