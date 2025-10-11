# Runtime Bridge Architecture

## Status

⚠️ **IMPLEMENTATION PLAN - NOT EXECUTED**

This document describes a detailed plan for unifying runtime provider architecture across all execution contexts. This is a refactoring that improves code quality but is not currently implemented.

## Problem

Runtime providers (artifacts, console, attachments, file downloads) are implemented separately for each context:

1. **Sandbox iframe**: Uses `window.parent.postMessage()`
2. **User script**: Duplicates logic with `chrome.runtime.sendMessage()`

Despite both contexts being equally isolated, we have duplicate implementations of every runtime function.

## Proposed Solution

Create unified messaging abstraction (`sendRuntimeMessage()`) that allows providers to be written once and work everywhere.

### Key Components

**RuntimeMessageBridge**: Generates context-specific bridge code
- Abstracts `postMessage()` vs `sendMessage()` differences
- Returns injectable string for each context

**RuntimeMessageRouter** (extended):
- Currently handles only iframe messages
- Would handle both iframe AND user script messages
- Single registration for all providers

**Refactored Providers**:
- Use `sendRuntimeMessage()` instead of context-specific APIs
- Detect offline mode via `!window.sendRuntimeMessage`
- Fallback to read-only snapshots offline

**FileDownloadRuntimeProvider** (new):
- Extracted from AttachmentsRuntimeProvider
- Handles only `returnDownloadableFile()`
- Works online (via extension) and offline (direct browser download)

### Benefits

**Code Reduction**:
- Before: 4 providers × 2 contexts = 8 implementations
- After: 4 providers × 1 implementation = 4 implementations
- Net: ~400 lines removed, ~200 lines added

**Features**:
- Zero duplication across contexts
- Full offline support for downloaded artifacts
- Clean separation of concerns
- Easy to add new providers

## Implementation Plan

Detailed in full document with 7 phases:

1. Create RuntimeMessageBridge
2. Extend SandboxMessageRouter → RuntimeMessageRouter
3. Refactor runtime providers (Console, Artifacts, Attachments)
4. Create FileDownloadRuntimeProvider
5. Update SandboxedIframe
6. Update browser-javascript.ts
7. Update exports and prompts

Full implementation details preserved in document for future reference.

## Testing Requirements

Would need to verify:
- Sandbox iframe (online): All providers work
- User script (extension): All providers work
- Downloaded artifact (offline): Read-only snapshot works
- Cross-provider compatibility: No conflicts
- Cleanup: No memory leaks

## Why Deferred

This is pure refactoring with no user-visible changes. Current system works reliably. Prioritizing feature development over code quality improvements.

## Related Files

- `docs/sandbox.md` - Overview of runtime system
- `docs/memories.md` - Future memory API (blocked by this)
- `pi-mono/packages/web-ui/src/components/sandbox/` - Current providers
- `sitegeist/src/tools/browser-javascript.ts` - Duplicate implementations

## Future Work

This architecture would enable:
- Memory persistence API (`memory.get/set`)
- Skills runtime provider (auto-inject functions)
- Network proxy provider (rate-limited fetch)
- Custom app-specific providers

Each would be a simple class implementing `SandboxRuntimeProvider` - no duplication needed.
