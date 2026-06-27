import { slugify } from "@/lib/utils";

const RESERVED_PUBLIC_SLUGS = new Set(["api", "app", "login", "logout", "opros", "s", "_next"]);
const PUBLIC_SLUG_MAX_LENGTH = 64;
const PUBLIC_SLUG_FALLBACK = "opros";
const TITLE_STOP_WORDS = new Set([
  "anketa",
  "candidate",
  "kandidata",
  "filtraciya",
  "filtratsiya",
  "i",
  "novyy",
  "novaya",
  "novoe",
  "rukovoditelya",
]);
const TITLE_WORD_REPLACEMENTS: Record<string, string> = {
  assistent: "assistant",
  okts: "okc",
};

function truncateSlug(value: string, maxLength = PUBLIC_SLUG_MAX_LENGTH) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).replace(/-+$/g, "") || PUBLIC_SLUG_FALLBACK;
}

function extractSlugCandidate(input: string) {
  const trimmed = input.trim();

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const surveySegmentIndex = segments.lastIndexOf("s");

    if (surveySegmentIndex >= 0 && segments[surveySegmentIndex + 1]) {
      return decodeURIComponent(segments[surveySegmentIndex + 1]!);
    }

    return decodeURIComponent(segments.at(-1) ?? trimmed);
  } catch {
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
    const segments = withoutQuery.split("/").filter(Boolean);
    const surveySegmentIndex = segments.lastIndexOf("s");

    if (surveySegmentIndex >= 0 && segments[surveySegmentIndex + 1]) {
      return decodeURIComponent(segments[surveySegmentIndex + 1]!);
    }

    return decodeURIComponent(segments.at(-1) ?? withoutQuery);
  }
}

export function buildPublicSlugBase(title: string) {
  const words = slugify(title)
    .split("-")
    .map((word) => TITLE_WORD_REPLACEMENTS[word] ?? word)
    .filter((word) => word && !TITLE_STOP_WORDS.has(word));

  return truncateSlug(words.join("-") || PUBLIC_SLUG_FALLBACK);
}

export function normalizePublicSlugInput(input: string) {
  const candidate = extractSlugCandidate(input);
  const rawSlug = slugify(candidate);
  const normalized = truncateSlug(rawSlug);

  if (!input.trim() || !normalized) {
    throw new Error("Адрес ссылки не может быть пустым.");
  }

  if (rawSlug === "survey" && !/[a-zа-я0-9]/i.test(candidate)) {
    throw new Error("Адрес ссылки должен содержать буквы или цифры.");
  }

  if (RESERVED_PUBLIC_SLUGS.has(normalized)) {
    throw new Error("Этот адрес зарезервирован.");
  }

  if (rawSlug.length > PUBLIC_SLUG_MAX_LENGTH) {
    throw new Error(`Адрес ссылки должен быть не длиннее ${PUBLIC_SLUG_MAX_LENGTH} символов.`);
  }

  return normalized;
}

export async function buildUniquePublicSlug(
  title: string,
  isTaken: (slug: string) => Promise<boolean>,
) {
  const base = buildPublicSlugBase(title);

  if (!(await isTaken(base))) {
    return base;
  }

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${truncateSlug(base, PUBLIC_SLUG_MAX_LENGTH - suffixText.length)}${suffixText}`;

    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error("Не удалось подобрать свободный адрес ссылки.");
}
