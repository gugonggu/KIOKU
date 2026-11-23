"use client";

import type { ReactNode } from "react";

export function SharedSectionLink({ section, preserveFragment, children }: {
  section: string; preserveFragment: boolean; children: ReactNode;
}) {
  return <a className="quiet-link" href={"#" + section} onClick={preserveFragment ? (event) => {
    event.preventDefault();
    document.getElementById(section)?.scrollIntoView();
  } : undefined}>{children}</a>;
}
