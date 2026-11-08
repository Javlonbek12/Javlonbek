import { cn } from "@/lib/utils";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

// A person's initials in a circle (the app has no photos): the team list and the card's header.
export function Avatar({
  name,
  muted = false,
  size = "md",
}: {
  name: string;
  muted?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "lg" ? "size-14 text-lg" : "size-9 text-sm",
        muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
      )}
    >
      {initials(name)}
    </span>
  );
}
