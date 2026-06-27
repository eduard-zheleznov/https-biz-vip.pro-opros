export const BLOCK_TYPES = [
  "WELCOME",
  "CONTACT",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "MEDIA_CHOICE",
  "YES_NO",
  "DROPDOWN",
  "RATING",
  "RANKING",
  "SCALE",
  "SLIDER",
  "TEXT",
  "COMBINED",
] as const;

export type SurveyBlockType = (typeof BLOCK_TYPES)[number];
export type CombinedInputBlockType = Exclude<SurveyBlockType, "WELCOME" | "CONTACT" | "TEXT" | "COMBINED">;

export type ContactFieldKey = "fullName" | "email" | "phone" | "company";
export type ContactAnswerValue = Record<string, string | string[]>;

export interface AdditionalInfoItem {
  id: string;
  label: string;
  description: string;
  mobileTextOverrides?: MobileTextOverrides;
}

export type MobileTextOverrideKey =
  | "title"
  | "description"
  | "questionHint"
  | "label"
  | "ctaLabel"
  | "submitLabel"
  | "yesLabel"
  | "noLabel"
  | "minLabel"
  | "maxLabel"
  | "placeholder"
  | "textPlaceholder"
  | "otherOptionLabel"
  | "otherPlaceholder";

export type MobileTextOverrides = Partial<Record<MobileTextOverrideKey, string>>;

export interface BaseSurveyBlock {
  id: string;
  type: SurveyBlockType;
  adminLabel: string;
  title: string;
  description: string;
  questionHint: string;
  mobileTextOverrides?: MobileTextOverrides;
  resultLabelOverride?: string | null;
  required: boolean;
  nextBlockId: string | null;
  showFinishButton: boolean;
  showRestartBlockButton?: boolean;
  additionalInfoEnabled: boolean;
  additionalInfoItemIds: string[];
  additionalInfoItems: AdditionalInfoItem[];
}

export interface ChoiceOption {
  id: string;
  label: string;
  description: string;
  mobileTextOverrides?: MobileTextOverrides;
  score: number;
  nextBlockId: string | null;
  mediaAssetId?: string | null;
  mediaUrl?: string | null;
}

export type TextAnswerAttachmentKind = "file" | "voice";

export interface TextAnswerAttachment {
  id: string;
  url: string;
  originalName: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  kind: TextAnswerAttachmentKind;
  transcript?: string | null;
  transcriptionStatus?: "completed" | "failed" | "skipped";
  transcriptionError?: string | null;
}

export interface TextAnswerValue {
  text: string;
  attachments: TextAnswerAttachment[];
}

export interface ContactField {
  id: ContactFieldKey;
  label: string;
  placeholder: string;
  mobileTextOverrides?: MobileTextOverrides;
  required: boolean;
  enabled: boolean;
}

export interface WelcomeBlock extends BaseSurveyBlock {
  type: "WELCOME";
  ctaLabel: string;
}

export interface ContactBlock extends BaseSurveyBlock {
  type: "CONTACT";
  fields: ContactField[];
  submitLabel: string;
}

export interface SingleChoiceBlock extends BaseSurveyBlock {
  type: "SINGLE_CHOICE";
  options: ChoiceOption[];
}

export interface MultiChoiceBlock extends BaseSurveyBlock {
  type: "MULTI_CHOICE";
  options: ChoiceOption[];
  minSelected: number;
  maxSelected: number | null;
}

export interface MediaChoiceBlock extends BaseSurveyBlock {
  type: "MEDIA_CHOICE";
  options: ChoiceOption[];
}

export interface YesNoBlock extends BaseSurveyBlock {
  type: "YES_NO";
  yesLabel: string;
  noLabel: string;
  yesScore: number;
  noScore: number;
  yesNextBlockId: string | null;
  noNextBlockId: string | null;
}

export interface DropdownBlock extends BaseSurveyBlock {
  type: "DROPDOWN";
  options: ChoiceOption[];
  placeholder: string;
  allowOtherOption: boolean;
  otherOptionLabel: string;
  otherPlaceholder: string;
}

export interface RatingBlock extends BaseSurveyBlock {
  type: "RATING";
  scale: number;
  icon: "star" | "heart";
  minLabel: string;
  maxLabel: string;
  scorePerUnit: number;
}

export interface RankingBlock extends BaseSurveyBlock {
  type: "RANKING";
  items: ChoiceOption[];
}

export interface ScaleBlock extends BaseSurveyBlock {
  type: "SCALE";
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
  scorePerUnit: number;
}

export interface SliderBlock extends BaseSurveyBlock {
  type: "SLIDER";
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  minLabel: string;
  maxLabel: string;
  scorePerUnit: number;
}

export interface TextBlock extends BaseSurveyBlock {
  type: "TEXT";
  placeholder: string;
  multiline: boolean;
  minLength: number;
  maxLength: number;
  allowVoiceAnswer: boolean;
  attachVoiceAnswerToResult: boolean;
  allowFileAnswer: boolean;
}

export type CombinedInputBlock =
  | SingleChoiceBlock
  | MultiChoiceBlock
  | MediaChoiceBlock
  | YesNoBlock
  | DropdownBlock
  | RatingBlock
  | RankingBlock
  | ScaleBlock
  | SliderBlock;

export interface CombinedBlock extends BaseSurveyBlock {
  type: "COMBINED";
  inputBlock: CombinedInputBlock;
  textPlaceholder: string;
  textMultiline: boolean;
  textMinLength: number;
  textMaxLength: number;
  textNextBlockId: string | null;
}

export interface DropdownOtherAnswerValue {
  optionId: string;
  otherText: string;
}

export interface CombinedAnswerValue {
  selectedValue: unknown;
  text: string;
}

export type SurveyBlock =
  | WelcomeBlock
  | ContactBlock
  | SingleChoiceBlock
  | MultiChoiceBlock
  | MediaChoiceBlock
  | YesNoBlock
  | DropdownBlock
  | RatingBlock
  | RankingBlock
  | ScaleBlock
  | SliderBlock
  | TextBlock
  | CombinedBlock;

export interface SurveySchemaSettings {
  language: string;
  autoScrollEnabled: boolean;
  timerEnabled: boolean;
  timerSeconds: number | null;
  completionMessage: string;
  showProgressBar: boolean;
  scoringEnabled: boolean;
  showRestartButton: boolean;
  additionalInfoItems: AdditionalInfoItem[];
  typography: SurveyTypographySettings;
  mobileTypography: SurveyTypographySettings;
}

export interface SurveyTypographySettings {
  eyebrowFontSize: number;
  titleFontSize: number;
  descriptionFontSize: number;
  answerFontSize: number;
  additionalInfoDescriptionFontSize: number;
}

export interface SurveySchema {
  title: string;
  description: string;
  settings: SurveySchemaSettings;
  blocks: SurveyBlock[];
}

export interface EvaluatedAnswer {
  blockId: string;
  blockType: SurveyBlockType;
  prompt: string;
  value: unknown;
  score: number;
  nextBlockId: string | null;
  respondentData?: ContactAnswerValue;
}

export interface RuntimeProgress {
  currentBlockId: string | null;
  totalScore: number;
  isFinished: boolean;
}

export interface SurveyAnswerRow {
  blockId: string;
  prompt: string;
  blockType: SurveyBlockType;
  value: string;
  score: number;
}
