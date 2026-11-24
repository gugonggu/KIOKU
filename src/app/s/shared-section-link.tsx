"use client";

import type { ReactNode } from "react";

export function SharedSectionLink({ section, preserveFragment, children }: {
  section: string; preserveFragment: boolean; children: ReactNode;
}) {
  if (preserveFragment) {
    return <button type="button" className="quiet-link" aria-controls={section} onClick={() => {
      const target = document.getElementById(section);
      target?.querySelector("h2")?.focus({ preventScroll: true });
      target?.scrollIntoView();
    }}>{children}</button>;
  }
  return <a className="quiet-link" href={"#" + section}>{children}</a>;
}
