# Prompts Documentation

This document describes all prompts/descriptions used in Sitegeist and where to find them.

## Location

All prompts are centralized in a single file for easy maintenance:

**[src/prompts/tool-prompts.ts](../src/prompts/tool-prompts.ts)**

## Available Prompts

### 1. System Prompt (`SYSTEM_PROMPT`)

**Used by:** [src/sidepanel.ts](../src/sidepanel.ts) (Agent initialization)

**Description:** The main system prompt that sets up the AI assistant's behavior, explains available tools, and provides detailed guidance on creating and using skills for token-efficient automation.

**Key sections:**
- Tool overview
- Skills explanation (why they matter, common functions)
- Skills usage instructions
- Skills creation workflow (with mandatory user testing)

**Usage:**
```typescript
import { SYSTEM_PROMPT } from "./prompts/tool-prompts.js";

const systemPrompt = SYSTEM_PROMPT + `
### Suggesting Skills
...additional context...
`;
```

### 2. Browser JavaScript Tool Description (`BROWSER_JAVASCRIPT_DESCRIPTION`)

**Used by:** [src/tools/browser-javascript.ts](../src/tools/browser-javascript.ts)

**Description:** Complete description of the `browser_javascript` tool that executes JavaScript code in the active browser tab's context.

**Key sections:**
- Environment capabilities (DOM access, page variables, web APIs, frameworks)
- Code execution context (main world access)
- Output options (console.log, returnFile, return values)
- Examples of common tasks
- Navigation warnings

**Usage:**
```typescript
import { BROWSER_JAVASCRIPT_DESCRIPTION } from "../prompts/tool-prompts.js";

export const browserJavaScriptTool: AgentTool<...> = {
	name: "browser_javascript",
	description: BROWSER_JAVASCRIPT_DESCRIPTION,
	...
};
```

### 3. Skill Management Tool Description (`SKILL_TOOL_DESCRIPTION`)

**Used by:** [src/tools/skill.ts](../src/tools/skill.ts)

**Description:** Complete description of the `skill` tool that manages reusable JavaScript libraries for domain-specific automation.

**Key sections:**
- Why skills matter (token efficiency, speed, consistency)
- What skills do (auto-inject, provide functions, save tokens)
- Example Gmail skill with full workflow
- Available actions (get, list, create, update, delete)
- Creating skills workflow (CRITICAL - with mandatory user testing steps)
- User testing requirements

**Usage:**
```typescript
import { SKILL_TOOL_DESCRIPTION } from "../prompts/tool-prompts.js";

export const skillTool: AgentTool<...> = {
	name: "skill",
	description: SKILL_TOOL_DESCRIPTION,
	...
};
```

## Related Prompts in pi-mono

Sitegeist also uses the shared web-ui library which has its own centralized prompts:

**[../pi-mono/packages/web-ui/src/prompts/tool-prompts.ts](../../pi-mono/packages/web-ui/src/prompts/tool-prompts.ts)**

This file contains:
- JavaScript REPL tool prompts (sandboxed JavaScript execution)
- Artifacts tool prompts (file artifact management)
- Attachments runtime provider prompts (file access APIs)

## Maintenance Guidelines

When updating prompts:

1. **Single Sources of Truth**: Always edit [src/prompts/tool-prompts.ts](../src/prompts/tool-prompts.ts) or [../pi-mono/packages/web-ui/src/prompts/tool-prompts.ts](../../pi-mono/packages/web-ui/src/prompts/tool-prompts.ts)
2. **Don't Duplicate**: Never copy prompts to other files - import them instead
3. **Test After Changes**: Run `npm run typecheck` to verify no breaking changes
4. **Keep Consistent**: Maintain consistent formatting and terminology across all prompts
5. **Document Changes**: Update this file if adding new prompts or changing structure
