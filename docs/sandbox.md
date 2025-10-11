# Sandbox Runtime System

## Status

⚠️ **IMPLEMENTATION PLAN - NOT EXECUTED**

This document describes a planned refactoring of the sandbox runtime injection system. The current implementation works but has technical debt.

## Current State

Runtime capabilities (console, artifacts, attachments) are injected into sandboxed execution contexts via providers:

**Implemented**:
- `ConsoleRuntimeProvider` - Console capture and error handling
- `ArtifactsRuntimeProvider` - Artifact CRUD operations
- `AttachmentsRuntimeProvider` - File reading API
- `SandboxMessageRouter` - Message routing for iframe contexts

**Works for**:
- JavaScript REPL (sandbox iframe)
- HTML artifacts (sandbox iframe)

**Limitations**:
- Browser JavaScript tool duplicates provider logic inline
- No offline support for downloaded artifacts
- Lifecycle concerns mixed with runtime code
- File download API incorrectly placed in AttachmentsRuntimeProvider

## Proposed Refactoring

### Goals

1. **Eliminate duplication**: Providers work in all contexts (iframe, user script, offline)
2. **Unified messaging**: Abstract iframe vs user script communication differences
3. **Offline support**: Downloaded artifacts work with read-only snapshots
4. **Clean separation**: Extract lifecycle logic from providers

### Components

**RuntimeMessageBridge**: Generate context-specific `sendRuntimeMessage()` functions
- Sandbox iframe: `window.parent.postMessage()`
- User script: `chrome.runtime.sendMessage()`
- Offline: No bridge (providers detect and fallback)

**RuntimeMessageRouter** (extends existing):
- Handle both iframe and user script messages
- Single registration point for all providers
- Automatic cleanup

**Refactored Providers**:
- Use `sendRuntimeMessage()` instead of direct APIs
- Support offline mode via snapshot fallback
- Remove lifecycle logic (move to wrapper code)

**New FileDownloadRuntimeProvider**:
- Extract `returnDownloadableFile()` from attachments
- Handle both online (via extension) and offline (direct download)

### Benefits

- 50% reduction in duplicate code (~400 lines)
- Consistent API across all contexts
- Downloaded artifacts work offline
- Easier to maintain and extend

## Implementation Phases

**Phase 1**: Create messaging abstraction (RuntimeMessageBridge)

**Phase 2**: Extend message router for user scripts

**Phase 3**: Refactor runtime providers to use bridge

**Phase 4**: Update SandboxedIframe to inject bridge

**Phase 5**: Update browser-javascript.ts to reuse providers

**Phase 6**: Add offline support via snapshots

## Related Files

- `docs/runtime-bridge.md` - Detailed implementation plan
- `pi-mono/packages/web-ui/src/components/SandboxedIframe.ts` - Current implementation
- `pi-mono/packages/web-ui/src/components/sandbox/` - Runtime providers
- `sitegeist/src/tools/browser-javascript.ts` - Duplicate implementations

## Why Not Implemented

This refactoring improves code quality but doesn't add user-visible features. It's been deferred in favor of shipping functionality. The current system works reliably despite the technical debt.
