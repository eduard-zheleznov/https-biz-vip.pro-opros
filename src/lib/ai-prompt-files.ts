import mammoth from "mammoth";

const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PROMPT_TEXT_LENGTH = 24000;

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXTUAL_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".html",
  ".htm",
  ".xml",
  ".yml",
  ".yaml",
  ".rtf",
]);
const TEXTUAL_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/rtf",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/rtf",
  "text/xml",
]);

export const AI_PROMPT_FILE_ACCEPT =
  ".txt,.md,.markdown,.json,.csv,.html,.htm,.xml,.yml,.yaml,.rtf,.docx";

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex).toLowerCase();
}

function normalizeExtractedText(text: string) {
  return text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function limitPromptTextLength(text: string, fileName: string) {
  if (text.length <= MAX_PROMPT_TEXT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_PROMPT_TEXT_LENGTH).trim()}\n\n[Текст файла "${fileName}" был сокращён системой, потому что он слишком длинный.]`;
}

function resolvePromptFileKind(file: File) {
  const extension = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase();
  const isDocx = extension === ".docx" || mimeType === DOCX_MIME_TYPE;
  const isTextual = TEXTUAL_FILE_EXTENSIONS.has(extension) || mimeType.startsWith("text/") || TEXTUAL_MIME_TYPES.has(mimeType);

  if (!isDocx && !isTextual) {
    throw new Error("Поддерживаются файлы TXT, MD, CSV, JSON, HTML, XML, YAML, RTF и DOCX.");
  }

  return {
    isDocx,
  };
}

async function extractPromptTextFromFile(file: File) {
  const trimmedName = file.name.trim();

  if (!trimmedName) {
    throw new Error("У прикреплённого файла отсутствует имя.");
  }

  if (file.size <= 0) {
    throw new Error("Прикреплённый файл пустой.");
  }

  if (file.size > MAX_PROMPT_FILE_BYTES) {
    throw new Error("Файл слишком большой. Максимальный размер для генерации с ИИ: 5 МБ.");
  }

  const { isDocx } = resolvePromptFileKind(file);

  const rawText = isDocx
    ? (
        await mammoth.extractRawText({
          buffer: Buffer.from(await file.arrayBuffer()),
        })
      ).value
    : await file.text();

  const normalizedText = normalizeExtractedText(rawText);
  if (!normalizedText) {
    throw new Error("Не удалось извлечь текст из файла. Проверьте, что внутри есть текстовое содержимое.");
  }

  return {
    fileName: trimmedName,
    text: limitPromptTextLength(normalizedText, trimmedName),
  };
}

export async function buildAiPromptInput(input: {
  prompt?: string | null;
  file?: FormDataEntryValue | null;
}) {
  const manualPrompt = input.prompt?.trim() ?? "";
  const uploadedFile = input.file instanceof File && input.file.size > 0 ? input.file : null;
  const extractedFile = uploadedFile ? await extractPromptTextFromFile(uploadedFile) : null;

  if (!manualPrompt && !extractedFile) {
    throw new Error("Укажите промт вручную или прикрепите файл с требованиями для генерации.");
  }

  if (!extractedFile) {
    return manualPrompt;
  }

  if (!manualPrompt) {
    return [
      `Построй опрос по содержимому прикреплённого файла "${extractedFile.fileName}".`,
      "",
      "Текст файла:",
      extractedFile.text,
    ].join("\n");
  }

  return [
    `Основной источник требований — прикреплённый файл "${extractedFile.fileName}".`,
    "Текст из поля промта ниже используй как дополнительные указания пользователя.",
    "",
    "Дополнительные указания:",
    manualPrompt,
    "",
    "Текст файла:",
    extractedFile.text,
  ].join("\n");
}
