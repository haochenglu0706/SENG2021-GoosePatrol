import type { ReactNode } from "react";

export function TopBar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        {subtitle ? <div className="topbar-sub">{subtitle}</div> : null}
      </div>
      {right}
    </header>
  );
}
