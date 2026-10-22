const API_PREFIX_TO_PAGE_ROUTE: Array<{ prefix: string; page: string }> = [
  { prefix: "/api/provided-services", page: "/data-management/provided-services" },
  { prefix: "/api/categories", page: "/data-management/categories" },
  { prefix: "/api/invoices", page: "/data-management/invoices" },
  { prefix: "/api/projects", page: "/data-management/projects" },
  { prefix: "/api/clients", page: "/data-management/clients" },
  { prefix: "/api/services", page: "/data-management/services" },
  { prefix: "/api/permits", page: "/data-management/permits" },
  { prefix: "/api/users", page: "/data-management/users" },
  { prefix: "/api/roles", page: "/data-management/roles" },
  { prefix: "/api/reminders", page: "/data-management/reminders" },
  { prefix: "/api/activity-logs", page: "/data-management/activity-logs" },
];

export function getCanonicalPagePath(rawPath?: string | null): string {
  if (!rawPath) return "";
  if (rawPath === "/" || rawPath === "/home") {
    return "/tracker/projects";
  }
  const apiRootPrefix = "/api/";
  if (rawPath.startsWith(apiRootPrefix)) {
    const clean = rawPath.split("?")[0].toLowerCase();
    for (const mapping of API_PREFIX_TO_PAGE_ROUTE) {
      if (clean === mapping.prefix || clean.startsWith(mapping.prefix + "/")) {
        return mapping.page;
      }
    }
    const resource = rawPath.replace(apiRootPrefix, "").split("?")[0].split("/")[0].toLowerCase();
    return `/data-management/${resource}`;
  }
  return rawPath;
}
