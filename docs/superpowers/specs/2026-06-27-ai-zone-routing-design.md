# AI Zone Routing Design

## Goal

Add optional per-survey behavior that uses the existing AI analysis result color to decide whether a Telegram notification is sent and what completion screen the respondent sees.

## Requirements

- Existing surveys keep current behavior unless the new settings are enabled.
- Results are always saved in the survey results list, regardless of AI color and Telegram delivery.
- Telegram can be filtered by AI color. The admin can choose green, yellow, red, or any combination.
- The final respondent page can optionally wait for AI analysis and then show a custom message for green, yellow, red, or fallback/no-color/error.
- The feature uses the existing AI prompt output convention. The preferred marker is `ЦВЕТ: ЗЕЛЁНЫЙ`, `ЦВЕТ: ЖЁЛТЫЙ`, or `ЦВЕТ: КРАСНЫЙ`.
- AI/API keys, Telegram settings, responses, and uploads must be preserved during deployment.

## Data Model

- `NotificationConfig` gains:
  - `telegramAiFilterEnabled Boolean @default(false)`
  - `telegramAiAllowedColors String[] @default([])`
- `AiAnalysisRule` gains:
  - `completionRoutingEnabled Boolean @default(false)`
  - processing title/message
  - green title/message
  - yellow title/message
  - red title/message
  - fallback title/message
- `ResponseSession` gains:
  - `aiResultColor String?`

The color is stored as `GREEN`, `YELLOW`, or `RED`. Unknown or missing AI color is stored as `null`.

## Data Flow

1. Respondent completes the survey.
2. Existing finalization saves the response and queues the background worker.
3. The worker runs AI analysis, extracts the color, and saves `aiNote`, `aiStatus`, and `aiResultColor`.
4. If Telegram is enabled:
   - if the AI color filter is off, Telegram sends as before;
   - if the filter is on, Telegram sends only when `aiResultColor` is in the selected colors.
5. If completion routing is enabled, `/s/[slug]/done` renders a client completion screen:
   - while AI is pending, it shows the processing animation and text;
   - when AI finishes, it shows the zone-specific text;
   - if AI fails, is skipped, or does not return a color, it shows the fallback text.

## Admin UX

In survey settings:

- Telegram block adds a checkbox `Фильтровать Telegram по AI-зоне` and zone checkboxes.
- AI block adds a checkbox `Показывать финальный экран по AI-зоне` and text fields for processing, green, yellow, red, and fallback messages.

## Error Handling

- If Telegram filtering is enabled but no colors are selected, the server defaults to green to avoid a silent "send nothing" configuration.
- If completion routing is enabled but AI is off or has no prompt/API key, saving settings should fail with a clear message.
- If OpenRouter/OpenAI analysis fails, the response remains saved and the respondent sees fallback text.
- If the respondent refreshes the completion page, the page polls current server state and does not duplicate responses.

## Testing

- Unit tests for AI color extraction and Telegram filter decisions.
- Unit tests for completion message selection.
- Build, lint, full test suite.
- Browser verification for settings UI and public completion screen.
