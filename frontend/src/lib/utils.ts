/** 轻量 className 合并（替代 clsx + tailwind-merge）。 */

export function cn(...parts: Array<string | undefined | false | null>): string {
  return parts.filter(Boolean).join(" ");
}
