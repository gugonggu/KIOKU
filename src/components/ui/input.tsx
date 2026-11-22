import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "min-h-12 w-full min-w-0 rounded-lg border border-field bg-paper px-3.5 text-base text-ink placeholder:text-muted-ink disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
