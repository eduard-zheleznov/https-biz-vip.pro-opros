function normalizeBasePath(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";

  if (!trimmed || trimmed === "/") {
    return "";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export const APP_BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_APP_BASE_PATH);

export function withBasePath(path: string) {
  if (!APP_BASE_PATH || /^https?:\/\//i.test(path) || path.startsWith("#")) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedPath === "/") {
    return APP_BASE_PATH;
  }

  if (normalizedPath === APP_BASE_PATH || normalizedPath.startsWith(`${APP_BASE_PATH}/`)) {
    return normalizedPath;
  }

  return `${APP_BASE_PATH}${normalizedPath}`;
}

export function appAbsoluteUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/, "")}${withBasePath(path)}`;
}
