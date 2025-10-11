# Prompts

## Overview

All agent prompts are centralized in a single file for maintainability and consistency.

## Location

`src/prompts/tool-prompts.ts`

## Prompts

### SYSTEM_PROMPT

Main system prompt for the AI assistant.

**Used by**: `src/sidepanel.ts` (agent initialization)

**Contains**:
- Available tools overview
- Skills explanation and usage
- Tool-specific guidance (navigation, browser JavaScript)
- Skills creation workflow

**Structure**:
```typescript
export const SYSTEM_PROMPT = `
# Available Tools
...tool descriptions...

# Skills
...skills explanation...
`;
```

### BROWSER_JAVASCRIPT_DESCRIPTION

Complete description of the `browser_javascript` tool.

**Used by**: `src/tools/browser-javascript.ts`

**Contains**:
- Environment capabilities (DOM, APIs, frameworks)
- Execution context details
- Output options
- Common task examples
- Navigation restrictions

### SKILL_TOOL_DESCRIPTION

Complete description of the `skill` tool.

**Used by**: `src/tools/skill.ts`

**Contains**:
- Why skills matter (token efficiency)
- Skill actions (get, list, create, update, delete)
- Creation workflow with user testing requirements
- Example Gmail skill

### NAVIGATE_TOOL_DESCRIPTION

Description of the `navigate` tool.

**Used by**: `src/tools/navigate.ts`

**Contains**:
- URL navigation
- History navigation (back/forward)
- Waits for page load completion
- Returns available skills

## Related Prompts

The shared web-ui library has its own prompts:

`pi-mono/packages/web-ui/src/prompts/tool-prompts.ts`

Contains:
- JavaScript REPL tool
- Artifacts tool
- Shared runtime descriptions

## Maintenance

### Updating Prompts

1. Edit `src/prompts/tool-prompts.ts`
2. Run `./check.sh` to verify no breaking changes
3. Test with actual agent interactions
4. Keep terminology consistent across all prompts

### Guidelines

- **Be concise**: LLMs work better with focused instructions
- **Use examples**: Show don't tell when possible
- **Be explicit**: State rules clearly (DO/DON'T, ALWAYS/NEVER)
- **Structure clearly**: Use headers and formatting
- **Test thoroughly**: Changes affect agent behavior

### Common Patterns

**Tool descriptions**:
```typescript
export const TOOL_DESCRIPTION = `
Brief one-line summary.

Parameters:
- param1: description
- param2: description

Returns: what the tool outputs

IMPORTANT: Critical usage notes
`;
```

**System prompt sections**:
```typescript
export const SYSTEM_PROMPT = `
## Section Title

Key points in structured format.

Examples:
- Example 1
- Example 2

CRITICAL: Important behaviors
`;
```

## Files

- `src/prompts/tool-prompts.ts` - Sitegeist prompts
- `pi-mono/packages/web-ui/src/prompts/tool-prompts.ts` - Shared prompts
