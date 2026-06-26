export const RICH_TEXT_COLOR_PALETTE = [
  { id: "black", label: "Черный", value: "#0f172a" },
  { id: "gray", label: "Серый", value: "#64748b" },
  { id: "red", label: "Красный", value: "#dc2626" },
  { id: "orange", label: "Оранжевый", value: "#ea580c" },
  { id: "yellow", label: "Желтый", value: "#ca8a04" },
  { id: "green", label: "Зеленый", value: "#16a34a" },
  { id: "cyan", label: "Голубой", value: "#0891b2" },
  { id: "blue", label: "Синий", value: "#2563eb" },
  { id: "violet", label: "Фиолетовый", value: "#7c3aed" },
  { id: "pink", label: "Розовый", value: "#db2777" },
] as const;

export type RichTextColorId = (typeof RICH_TEXT_COLOR_PALETTE)[number]["id"];

export type RichTextSegment = {
  text: string;
  colorId: RichTextColorId | null;
  bold: boolean;
};

const RICH_TEXT_TAG_PATTERN = /\[color=([a-z0-9_-]+)\]|\[\/color\]|\[b\]|\[\/b\]/gi;
const RICH_TEXT_COLOR_BY_ID = new Map(RICH_TEXT_COLOR_PALETTE.map((color) => [color.id, color]));

export function getRichTextColor(colorId: string | null | undefined) {
  if (!colorId) {
    return null;
  }

  return RICH_TEXT_COLOR_BY_ID.get(colorId.toLowerCase() as RichTextColorId) ?? null;
}

export function parseRichTextSegments(value: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const colorStack: Array<RichTextColorId | null> = [];
  let boldDepth = 0;
  let cursor = 0;

  const currentColorId = () => {
    for (let index = colorStack.length - 1; index >= 0; index -= 1) {
      const colorId = colorStack[index];
      if (colorId) {
        return colorId;
      }
    }

    return null;
  };

  const pushSegment = (text: string) => {
    if (!text) {
      return;
    }

    const colorId = currentColorId();
    const bold = boldDepth > 0;
    const previous = segments[segments.length - 1];

    if (previous && previous.colorId === colorId && previous.bold === bold) {
      previous.text += text;
      return;
    }

    segments.push({ text, colorId, bold });
  };

  RICH_TEXT_TAG_PATTERN.lastIndex = 0;

  for (const match of value.matchAll(RICH_TEXT_TAG_PATTERN)) {
    const matchIndex = match.index ?? cursor;

    pushSegment(value.slice(cursor, matchIndex));

    if (match[1]) {
      colorStack.push(getRichTextColor(match[1])?.id ?? null);
    } else {
      const tag = match[0].toLowerCase();
      if (tag === "[/color]" && colorStack.length > 0) {
        colorStack.pop();
      } else if (tag === "[b]") {
        boldDepth += 1;
      } else if (tag === "[/b]" && boldDepth > 0) {
        boldDepth -= 1;
      }
    }

    cursor = matchIndex + match[0].length;
  }

  pushSegment(value.slice(cursor));

  return segments;
}

export function stripRichTextTokens(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return parseRichTextSegments(value)
    .map((segment) => segment.text)
    .join("");
}
