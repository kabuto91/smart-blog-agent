export function normalizeRoute(path: string): string {
  const clean = path.trim().split("?")[0].split("#")[0]
  if (!clean || clean === "/") return "/"
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`
  return withSlash.replace(/\/+$/, "") || "/"
}
