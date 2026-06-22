const SOURCE_FILE_PATTERN = /^\/src\/.+\.(?:ts|tsx|js|jsx)(?:$|[?#])/;

type SourceNavigationRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(",") : value ?? "";
}

export function shouldRedirectSourceNavigation(req: SourceNavigationRequest): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const url = req.url ?? "";
  if (!SOURCE_FILE_PATTERN.test(url)) {
    return false;
  }

  const fetchDestination = headerValue(req.headers["sec-fetch-dest"]);
  if (fetchDestination === "document") {
    return true;
  }

  const accept = headerValue(req.headers.accept);
  return accept.includes("text/html") && !accept.includes("text/javascript") && !accept.includes("application/javascript");
}
