import type { ReactNode } from "react";

import { getRichTextColor, parseRichTextSegments } from "@/lib/rich-text";

export function renderRichText(value: string): ReactNode[] {
  return parseRichTextSegments(value).map((segment, index) => {
    const color = getRichTextColor(segment.colorId);

    if (!color && !segment.bold) {
      return segment.text;
    }

    return (
      <span
        key={`${index}-${color?.id ?? "plain"}-${segment.bold ? "bold" : "regular"}`}
        style={{
          color: color?.value,
          fontWeight: segment.bold ? 700 : undefined,
        }}
      >
        {segment.text}
      </span>
    );
  });
}
