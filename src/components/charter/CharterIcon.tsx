import * as Icons from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * Registry-driven icon resolver for the charter catalog. Keeps the catalog a
 * plain data module (icon names as strings) without duplicating icon imports
 * in every consumer.
 */
export function CharterIcon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name] ?? Icons.Package;
  return <Cmp aria-hidden {...props} />;
}

export default CharterIcon;
