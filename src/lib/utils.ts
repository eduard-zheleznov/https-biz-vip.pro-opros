import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const cyrillicMap: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ы: "y",
  э: "e",
  ю: "yu",
  я: "ya",
  ь: "",
  ъ: "",
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function transliterate(value: string) {
  return value
    .toLowerCase()
    .split("")
    .map((char) => cyrillicMap[char] ?? char)
    .join("");
}

export function slugify(value: string) {
  const prepared = transliterate(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return prepared || "survey";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value == null ? [] : [value];
}

export function formatDateTime(value: Date | string | null | undefined, locale = "ru-RU") {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDateTimeInTimeZone(
  value: Date | string | null | undefined,
  options?: {
    locale?: string;
    timeZone?: string;
  },
) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(options?.locale ?? "ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options?.timeZone,
  }).format(date);
}

export function formatSurveyLifecycleStatus(status: string) {
  switch (status) {
    case "DRAFT":
      return "Черновик";
    case "PUBLISHED":
      return "Опубликован";
    case "ARCHIVED":
      return "В архиве";
    default:
      return status;
  }
}

export function formatResponseStatus(status: string) {
  switch (status) {
    case "COMPLETED":
      return "Завершён";
    case "PARTIAL":
      return "Частично";
    case "TIMED_OUT":
      return "Время вышло";
    case "IN_PROGRESS":
      return "В процессе";
    default:
      return status;
  }
}

export function formatNumber(value: number, locale = "ru-RU") {
  return new Intl.NumberFormat(locale).format(value);
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]) {
  return keys.reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {} as Pick<T, K>);
}

export function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((chunk) => `${chunk[0]?.toUpperCase() ?? ""}${chunk.slice(1).toLowerCase()}`)
    .join(" ");
}
