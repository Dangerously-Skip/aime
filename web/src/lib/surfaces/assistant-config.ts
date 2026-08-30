import type { SurfaceConfig } from './index';
import { factualClaimsPrompt } from './shared/factual-claims';
import { APP_NAME } from '@/config/branding';
import { TURN_BACKSTOP } from './shared/limits';

export function getAssistantConfig(overrides: Partial<SurfaceConfig> = {}): SurfaceConfig {
  return {
    allowedTools: [
      'mcp__aime__FetchUrl', 'mcp__aime__MailSearch', 'mcp__aime__MailRead', 'mcp__aime__MailDraft', 'mcp__aime__CalendarEvents', 'mcp__aime__ContactsSearch',
      'WebSearch', 'WebFetch', 'mcp__aime__canvas',
      /*
       * PREFIXED, like every other entry above — and they were not.
       *
       * These live on the in-process `aime` MCP server, so the SDK knows them
       * as `mcp__aime__StandingOrderCreate`. Listed bare they match nothing, so
       * the Assistant's OWN core tools were never auto-approved.
       *
       * That is invisible on every other surface, because they all run
       * `acceptEdits` or `bypassPermissions` and an unlisted tool is allowed
       * anyway. This is the ONE surface on `permissionMode: 'default'`, where an
       * unlisted tool prompts — so the prompt is the whole behaviour, and when
       * it did not land the model reported "both calls hit a permission issue",
       * fell back to `CronCreate`, and retried, leaving three duplicate
       * standing orders and no widget.
       */
      'mcp__aime__StandingOrderCreate', 'mcp__aime__StandingOrderList',
      'mcp__aime__StandingOrderUpdate', 'mcp__aime__StandingOrderCancel',
      'mcp__aime__StandingOrderHistory',
      /*
       * The Assistant is where a user asks for a widget — "I want a checklist
       * in my cockpit" is this surface's job, and it could not do it. It only
       * pins a tile to the user's own Cockpit.
       */
      'mcp__aime__WidgetCreate',
    ],
    permissionMode: 'default',
    systemPrompt: `You are the Personal Assistant for ${APP_NAME}. You help users schedule reminders, create standing orders, and manage recurring tasks.

## CRITICAL RULE
When the user asks to be reminded, to schedule something, to watch/monitor something, or to do something on a recurring basis — you MUST use the StandingOrderCreate tool. Do NOT just describe what you would do. Do NOT use Bash or crontab. ALWAYS call the StandingOrderCreate tool.

## StandingOrderCreate Tool
Use this tool for ALL scheduling, reminder, and monitoring requests. Parameters:
- **instruction** (required): What to do when this fires
- **trigger_type** (required): "cron" for specific times, "interval" for recurring delays
- **expression** (required): Cron expression (e.g. "0 9 * * 1-5" for 9am weekdays) or interval (e.g. "1m", "5m", "2h")
- **condition**: Only act when this is true (optional)
- **completionCondition**: Auto-complete when met (optional)
- **maxExecutions**: Max times to run (optional)
- **notifyVia**: "assistant" (default) or "toast" for desktop notification

Examples:
- "remind me in 5 minutes" → trigger_type: "interval", expression: "5m", maxExecutions: 1
- "every morning at 9" → trigger_type: "cron", expression: "0 9 * * *"
- "every 30 minutes" → trigger_type: "interval", expression: "30m"
- "remind me in 1 minute" → trigger_type: "interval", expression: "1m", maxExecutions: 1

## Tone
Be concise. After calling StandingOrderCreate, confirm in one sentence what was scheduled. Do not explain how standing orders work — just confirm the action.

${factualClaimsPrompt()}`,
    model: 'sonnet',
    /* Standing orders run unattended — see TURN_BACKSTOP. */
    maxTurns: TURN_BACKSTOP.unattended,
    maxBudgetUsd: 1.0,
    queryTimeoutSecs: 300,
    includePartialMessages: true,
    mcpServers: {},
    ...overrides,
  };
}
