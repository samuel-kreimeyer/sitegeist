# Sandbox Runtime Injection System

## Problem Statement

Currently, `SandboxedIframe` in web-ui has a hardcoded mechanism for injecting data and runtime functions into sandboxed iframe contexts. This approach is:

1. **Inflexible**: Adding new runtime capabilities (like memory API) requires modifying the core `SandboxedIframe` class
2. **Non-extensible**: Each new feature requires changes to `getRuntimeScript()` and its signature
3. **Tightly coupled**: Attachments are the only injected feature, making it hard to add memories, skills, or future capabilities
4. **Inconsistent**: The pattern of "inject data + runtime function" is repeated but not abstracted

### Current Implementation

**File**: `packages/web-ui/src/components/SandboxedIframe.ts`

#### How it works now:

1. **Data Injection** (lines 516-523):
```typescript
private getRuntimeScript(sandboxId: string, attachments: Attachment[]): string {
  const attachmentsData = attachments.map(a => ({ id, fileName, mimeType, size, content, extractedText }));

  const runtimeFunc = () => {
    // Runtime function body with helper functions for attachments
    (window as any).listFiles = () => (attachments || []).map(...);
    (window as any).readTextFile = (attachmentId: string) => { ... };
    (window as any).readBinaryFile = (attachmentId: string) => { ... };
    // ... more runtime code ...
  };

  return (
    `<script>\n` +
    `window.sandboxId = ${JSON.stringify(sandboxId)};\n` +
    `window.attachments = ${JSON.stringify(attachmentsData)};\n` +  // <-- Hardcoded
    `(${runtimeFunc.toString()})();\n` +
    `</script>`
  );
}
```

2. **Invocation Points**:
   - `loadContent()` - For HTML artifacts (persistent display)
   - `execute()` - For REPL execution (one-shot)

3. **Problem**: To add memory API, we'd need to:
   - Add `memorySnapshot` parameter to `getRuntimeScript()`
   - Add `window.memorySnapshot = ...` line
   - Add memory API functions inside `runtimeFunc()`
   - Update all call sites
   - Repeat this for every new feature

## Proposed Solution: Runtime Provider Pattern

Create a **generic, extensible runtime injection system** where each feature provides:
1. **Data** to inject into `window`
2. **Runtime function** that implements the API

### Architecture

```typescript
// Core interface
interface SandboxRuntimeProvider {
  // Data to inject into window scope
  getData(): Record<string, any>;

  // Runtime function that will be stringified and executed in sandbox
  // Function has access to sandboxId and any data from getData()
  getRuntime(): (sandboxId: string) => void;
}
```

### Usage Pattern

```typescript
// Runtime providers passed as parameters to execute/loadContent
const sandbox = new SandboxedIframe();

const runtimeProviders = [
  new ConsoleRuntimeProvider(),  // REQUIRED - always include first
  new AttachmentsRuntimeProvider(attachments),
  new MemoryRuntimeProvider(sessionId, memorySnapshot),
  new SkillsRuntimeProvider(skills)  // Future
];

// For REPL execution
await sandbox.execute(sandboxId, code, runtimeProviders, signal);

// For HTML artifact display
sandbox.loadContent(sandboxId, htmlContent, runtimeProviders);

// Internally, SandboxedIframe composes all runtimes
private getRuntimeScript(sandboxId: string, providers: SandboxRuntimeProvider[]): string {
  const allData = {};
  const allRuntimeFuncs: string[] = [];

  for (const provider of providers) {
    Object.assign(allData, provider.getData());
    allRuntimeFuncs.push(`(${provider.getRuntime().toString()})(sandboxId);`);
  }

  return (
    `<script>\n` +
    `window.sandboxId = ${JSON.stringify(sandboxId)};\n` +
    Object.entries(allData).map(([key, val]) =>
      `window.${key} = ${JSON.stringify(val)};\n`
    ).join('') +
    allRuntimeFuncs.join('\n') +
    `</script>`
  );
}
```

## Implementation Plan

### 1. Create Runtime Provider Interface

**New File**: `packages/web-ui/src/components/sandbox/SandboxRuntimeProvider.ts`

```typescript
/**
 * Interface for providing runtime capabilities to sandboxed iframes.
 * Each provider injects data and runtime functions into the sandbox context.
 */
export interface SandboxRuntimeProvider {
  /**
   * Returns data to inject into window scope.
   * Keys become window properties (e.g., { attachments: [...] } -> window.attachments)
   */
  getData(): Record<string, any>;

  /**
   * Returns a runtime function that will be stringified and executed in the sandbox.
   * The function receives sandboxId and has access to data from getData() via window.
   *
   * IMPORTANT: This function will be converted to string via .toString() and injected
   * into the sandbox, so it cannot reference external variables or imports.
   */
  getRuntime(): (sandboxId: string) => void;
}
```

### 2. Create Console Runtime Provider

**New File**: `packages/web-ui/src/components/sandbox/ConsoleRuntimeProvider.ts`

This is a **required** provider that should always be included. It provides console capture, error handling, and execution lifecycle management.

```typescript
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

export class ConsoleRuntimeProvider implements SandboxRuntimeProvider {
  getData(): Record<string, any> {
    // No data needed
    return {};
  }

  getRuntime(): (sandboxId: string) => void {
    return (sandboxId: string) => {
      // Console capture
      const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
      };

      ["log", "error", "warn", "info"].forEach((method) => {
        (console as any)[method] = (...args: any[]) => {
          const text = args
            .map((arg) => {
              try {
                return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
              } catch {
                return String(arg);
              }
            })
            .join(" ");

          window.parent.postMessage(
            {
              type: "console",
              sandboxId,
              method,
              text,
            },
            "*",
          );

          (originalConsole as any)[method].apply(console, args);
        };
      });

      // Track errors for HTML artifacts
      let lastError: { message: string; stack: string } | null = null;

      // Error handlers
      window.addEventListener("error", (e) => {
        const text =
          (e.error?.stack || e.message || String(e)) + " at line " + (e.lineno || "?") + ":" + (e.colno || "?");

        lastError = {
          message: e.error?.message || e.message || String(e),
          stack: e.error?.stack || text,
        };

        window.parent.postMessage(
          {
            type: "console",
            sandboxId,
            method: "error",
            text,
          },
          "*",
        );
      });

      window.addEventListener("unhandledrejection", (e) => {
        const text = "Unhandled promise rejection: " + (e.reason?.message || e.reason || "Unknown error");

        lastError = {
          message: e.reason?.message || String(e.reason) || "Unhandled promise rejection",
          stack: e.reason?.stack || text,
        };

        window.parent.postMessage(
          {
            type: "console",
            sandboxId,
            method: "error",
            text,
          },
          "*",
        );
      });

      // Expose complete() method for user code to call
      let completionSent = false;
      (window as any).complete = (error?: { message: string; stack: string }) => {
        if (completionSent) return;
        completionSent = true;

        const finalError = error || lastError;

        if (finalError) {
          window.parent.postMessage(
            {
              type: "execution-error",
              sandboxId,
              error: finalError,
            },
            "*",
          );
        } else {
          window.parent.postMessage(
            {
              type: "execution-complete",
              sandboxId,
            },
            "*",
          );
        }
      };

      // Fallback timeout for HTML artifacts that don't call complete()
      if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(() => (window as any).complete(), 2000);
      } else {
        window.addEventListener("load", () => {
          setTimeout(() => (window as any).complete(), 2000);
        });
      }
    };
  }
}
```

### 3. Create Attachments Runtime Provider

**New File**: `packages/web-ui/src/components/sandbox/AttachmentsRuntimeProvider.ts`

```typescript
import type { Attachment } from "../../utils/attachment-utils.js";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

export class AttachmentsRuntimeProvider implements SandboxRuntimeProvider {
  constructor(private attachments: Attachment[]) {}

  getData(): Record<string, any> {
    const attachmentsData = this.attachments.map(a => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      content: a.content,
      extractedText: a.extractedText,
    }));

    return { attachments: attachmentsData };
  }

  getRuntime(): (sandboxId: string) => void {
    // This function will be stringified, so no external references!
    return (sandboxId: string) => {
      // Helper functions for attachments
      (window as any).listFiles = () =>
        ((window as any).attachments || []).map((a: any) => ({
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          size: a.size,
        }));

      (window as any).readTextFile = (attachmentId: string) => {
        const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
        if (!a) throw new Error("Attachment not found: " + attachmentId);
        if (a.extractedText) return a.extractedText;
        try {
          return atob(a.content);
        } catch {
          throw new Error("Failed to decode text content for: " + attachmentId);
        }
      };

      (window as any).readBinaryFile = (attachmentId: string) => {
        const a = ((window as any).attachments || []).find((x: any) => x.id === attachmentId);
        if (!a) throw new Error("Attachment not found: " + attachmentId);
        const bin = atob(a.content);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      };

      (window as any).returnFile = async (fileName: string, content: any, mimeType?: string) => {
        let finalContent: any, finalMimeType: string;

        if (content instanceof Blob) {
          const arrayBuffer = await content.arrayBuffer();
          finalContent = new Uint8Array(arrayBuffer);
          finalMimeType = mimeType || content.type || "application/octet-stream";
          if (!mimeType && !content.type) {
            throw new Error(
              "returnFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., 'image/png').",
            );
          }
        } else if (content instanceof Uint8Array) {
          finalContent = content;
          if (!mimeType) {
            throw new Error(
              "returnFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., 'image/png').",
            );
          }
          finalMimeType = mimeType;
        } else if (typeof content === "string") {
          finalContent = content;
          finalMimeType = mimeType || "text/plain";
        } else {
          finalContent = JSON.stringify(content, null, 2);
          finalMimeType = mimeType || "application/json";
        }

        window.parent.postMessage(
          {
            type: "file-returned",
            sandboxId,
            fileName,
            content: finalContent,
            mimeType: finalMimeType,
          },
          "*",
        );
      };
    };
  }
}
```

### 4. Create Memory Runtime Provider

**New File**: `packages/web-ui/src/components/sandbox/MemoryRuntimeProvider.ts`

```typescript
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";

export class MemoryRuntimeProvider implements SandboxRuntimeProvider {
  constructor(
    private sessionId: string,
    private memorySnapshot: Record<string, any>
  ) {}

  getData(): Record<string, any> {
    return {
      __memorySnapshot: this.memorySnapshot,
      __sessionId: this.sessionId
    };
  }

  getRuntime(): (sandboxId: string) => void {
    return (sandboxId: string) => {
      let memoryRequestId = 0;

      (window as any).memory = {
        async get(key: string): Promise<any> {
          // Try live fetch first (for when running inside app)
          try {
            const reqId = `${sandboxId}_mem_${memoryRequestId++}`;
            const result = await Promise.race([
              new Promise((resolve, reject) => {
                const handler = (e: MessageEvent) => {
                  if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
                    window.removeEventListener('message', handler);
                    resolve(e.data.value ? JSON.parse(e.data.value) : undefined);
                  }
                };
                window.addEventListener('message', handler);
                window.parent.postMessage({
                  type: 'memory_get',
                  sandboxId,
                  requestId: reqId,
                  key
                }, '*');
              }),
              // Timeout fallback
              new Promise((_, reject) => setTimeout(() => reject('timeout'), 100))
            ]);
            return result;
          } catch {
            // Fall back to snapshot (for when running standalone)
            return (window as any).__memorySnapshot[key];
          }
        },

        async set(key: string, value: any): Promise<void> {
          // Always update local snapshot
          (window as any).__memorySnapshot[key] = value;

          // Try to persist remotely (best effort)
          try {
            const reqId = `${sandboxId}_mem_${memoryRequestId++}`;
            await Promise.race([
              new Promise((resolve) => {
                const handler = (e: MessageEvent) => {
                  if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
                    window.removeEventListener('message', handler);
                    resolve(undefined);
                  }
                };
                window.addEventListener('message', handler);
                window.parent.postMessage({
                  type: 'memory_set',
                  sandboxId,
                  requestId: reqId,
                  key,
                  value: JSON.stringify(value)
                }, '*');
              }),
              new Promise((_, reject) => setTimeout(() => reject('timeout'), 100))
            ]);
          } catch {
            // Silently fail - snapshot is already updated
          }
        },

        async has(key: string): Promise<boolean> {
          const value = await (window as any).memory.get(key);
          return value !== undefined;
        },

        async delete(key: string): Promise<void> {
          delete (window as any).__memorySnapshot[key];
          try {
            const reqId = `${sandboxId}_mem_${memoryRequestId++}`;
            await Promise.race([
              new Promise((resolve) => {
                const handler = (e: MessageEvent) => {
                  if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
                    window.removeEventListener('message', handler);
                    resolve(undefined);
                  }
                };
                window.addEventListener('message', handler);
                window.parent.postMessage({
                  type: 'memory_delete',
                  sandboxId,
                  requestId: reqId,
                  key
                }, '*');
              }),
              new Promise((_, reject) => setTimeout(() => reject('timeout'), 100))
            ]);
          } catch {
            // Silently fail
          }
        },

        async clear(): Promise<void> {
          (window as any).__memorySnapshot = {};
          try {
            const reqId = `${sandboxId}_mem_${memoryRequestId++}`;
            await Promise.race([
              new Promise((resolve) => {
                const handler = (e: MessageEvent) => {
                  if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
                    window.removeEventListener('message', handler);
                    resolve(undefined);
                  }
                };
                window.addEventListener('message', handler);
                window.parent.postMessage({
                  type: 'memory_clear',
                  sandboxId,
                  requestId: reqId
                }, '*');
              }),
              new Promise((_, reject) => setTimeout(() => reject('timeout'), 100))
            ]);
          } catch {
            // Silently fail
          }
        },

        async keys(): Promise<string[]> {
          try {
            const reqId = `${sandboxId}_mem_${memoryRequestId++}`;
            const result = await Promise.race([
              new Promise<string[]>((resolve) => {
                const handler = (e: MessageEvent) => {
                  if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
                    window.removeEventListener('message', handler);
                    resolve(e.data.keys || []);
                  }
                };
                window.addEventListener('message', handler);
                window.parent.postMessage({
                  type: 'memory_keys',
                  sandboxId,
                  requestId: reqId
                }, '*');
              }),
              new Promise<string[]>((_, reject) => setTimeout(() => reject('timeout'), 100))
            ]);
            return result;
          } catch {
            // Fall back to snapshot keys
            return Object.keys((window as any).__memorySnapshot);
          }
        },
      };
    };
  }
}
```

### 5. Refactor SandboxedIframe

**File**: `packages/web-ui/src/components/SandboxedIframe.ts`

#### Changes Needed:

**Refactor `getRuntimeScript()` to accept providers parameter:**
```typescript
private getRuntimeScript(sandboxId: string, providers: SandboxRuntimeProvider[] = []): string {
  // Collect all data from providers
  const allData: Record<string, any> = {};
  for (const provider of providers) {
    Object.assign(allData, provider.getData());
  }

  // Collect all runtime functions
  const runtimeFunctions: string[] = [];
  for (const provider of providers) {
    runtimeFunctions.push(`(${provider.getRuntime().toString()})(sandboxId);`);
  }

  // Build script
  const dataInjection = Object.entries(allData)
    .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
    .join('\n');

  return (
    `<script>\n` +
    `window.sandboxId = ${JSON.stringify(sandboxId)};\n` +
    dataInjection + '\n' +
    runtimeFunctions.join('\n') +
    `</script>`
  );
}
```

**Update `prepareHtmlDocument()` signature and make it public:**
```typescript
// CHANGE FROM private TO public
public prepareHtmlDocument(
  sandboxId: string,
  userCode: string,
  providers: SandboxRuntimeProvider[] = []
): string {
  // Runtime script uses passed-in providers
  const runtime = this.getRuntimeScript(sandboxId, providers);

  // ... rest stays the same
}
```

**Why public?** So HtmlArtifact's download button can call it to generate standalone HTML with all runtime code injected.

**Remove old parameters:**
- Remove `attachments` parameter from `getRuntimeScript()`
- Remove `attachments` parameter from `prepareHtmlDocument()`

**Update `execute()` method signature:**
```typescript
public async execute(
  sandboxId: string,
  code: string,
  providers: SandboxRuntimeProvider[] = [],
  signal?: AbortSignal,
): Promise<SandboxResult> {
  // ... existing code ...

  // Prepare the complete HTML document with runtime + user code
  const completeHtml = this.prepareHtmlDocument(sandboxId, code, providers);

  // ... rest stays the same
}
```

**Update `loadContent()` method signature:**
```typescript
public loadContent(
  sandboxId: string,
  htmlContent: string,
  providers: SandboxRuntimeProvider[] = []
): void {
  const completeHtml = this.prepareHtmlDocument(sandboxId, htmlContent, providers);

  // ... rest stays the same
}
```

### 6. Update HtmlArtifact

**File**: `packages/web-ui/src/tools/artifacts/HtmlArtifact.ts`

#### Changes:

**Remove attachments property, add runtime providers property:**
```typescript
// REMOVE:
@property({ attribute: false }) attachments: Attachment[] = [];

// ADD:
@property({ attribute: false }) runtimeProviders: SandboxRuntimeProvider[] = [];
```

**Update `executeContent()` to use router instead of direct addEventListener:**
```typescript
private consumerRegistration: MessageConsumer | null = null;

private executeContent(html: string) {
  const sandbox = this.sandboxIframeRef.value;
  if (!sandbox) return;

  // Configure sandbox URL provider if provided (for browser extensions)
  if (this.sandboxUrlProvider) {
    sandbox.sandboxUrlProvider = this.sandboxUrlProvider;
  }

  const sandboxId = `artifact-${this.filename}`;

  // Register as message consumer for console messages (uses router)
  this.consumerRegistration = {
    handleMessage: (message: any) => {
      if (message.type === "console") {
        // Create new array reference for Lit reactivity
        this.logs = [
          ...this.logs,
          {
            type: message.method === "error" ? "error" : "log",
            text: message.text,
          },
        ];
        this.requestUpdate(); // Re-render to show console
      }
    }
  };

  SANDBOX_MESSAGE_ROUTER.addConsumer(sandboxId, this.consumerRegistration);

  // Load content with runtime providers (passed from ArtifactsPanel)
  sandbox.loadContent(sandboxId, html, this.runtimeProviders);
}

override disconnectedCallback() {
  super.disconnectedCallback();

  // Unregister consumer
  if (this.currentSandboxId && this.consumerRegistration) {
    SANDBOX_MESSAGE_ROUTER.removeConsumer(this.currentSandboxId, this.consumerRegistration);
    this.consumerRegistration = null;
  }
}
```

**Update download button to include runtime code:**
```typescript
private getHeaderButtons() {
  const sandbox = this.sandboxIframeRef.value;
  const sandboxId = `artifact-${this.filename}`;

  // Generate standalone HTML with all runtime code injected
  const downloadContent = sandbox?.prepareHtmlDocument(
    sandboxId,
    this._content,
    this.runtimeProviders || []
  );

  return html`${DownloadButton({
    content: downloadContent || this._content,
    filename: this.filename,
    mimeType: "text/html",
    title: i18n("Download HTML")
  })}`;
}
```

**Important**: Downloaded artifacts now include all runtime provider code, making them self-contained and runnable standalone (with degraded functionality for features like memory that require the extension).

### 7. Update ArtifactsPanel

**File**: `packages/web-ui/src/tools/artifacts/artifacts.ts`

#### Changes:

**Replace `attachmentsProvider` with `runtimeProvidersFactory`:**
```typescript
// REMOVE:
@property({ attribute: false }) attachmentsProvider?: () => Attachment[];

// ADD:
@property({ attribute: false }) runtimeProvidersFactory?: () => SandboxRuntimeProvider[];
```

**Update `getOrCreateArtifactElement()` to use runtime providers factory:**
```typescript
private getOrCreateArtifactElement(filename: string, content: string, title: string): ArtifactElement {
  let element = this.artifactElements.get(filename);

  if (!element) {
    const type = this.getFileType(filename);
    if (type === "html") {
      element = new HtmlArtifact();

      // Get runtime providers from factory
      const runtimeProviders = this.runtimeProvidersFactory?.() || [];
      (element as HtmlArtifact).runtimeProviders = runtimeProviders;

      if (this.sandboxUrlProvider) {
        (element as HtmlArtifact).sandboxUrlProvider = this.sandboxUrlProvider;
      }
    } else if (type === "svg") {
      // ... rest unchanged
    }
    // ... rest unchanged
  } else {
    // Update existing element
    element.content = content;
    element.displayTitle = title;
    if (element instanceof HtmlArtifact) {
      // Update runtime providers
      const runtimeProviders = this.runtimeProvidersFactory?.() || [];
      element.runtimeProviders = runtimeProviders;
    }
  }

  return element;
}
```

**Update tool description (remove attachment-specific documentation):**
The tool description in the `tool` getter currently mentions attachments explicitly (lines 214-241). This should be updated to be more generic since runtime capabilities are now injected via providers:

```typescript
// OLD:
For text/html artifacts with attachments:
- HTML artifacts automatically have access to user attachments via JavaScript
- Available global functions in HTML artifacts:
  * listFiles() - Returns array of {id, fileName, mimeType, size} for all attachments
  ...

// NEW:
For text/html artifacts:
- HTML artifacts may have access to various runtime APIs depending on configuration
- Common runtime APIs include:
  * Attachment functions (listFiles, readTextFile, readBinaryFile) - if attachments are available
  * Memory API (memory.get, memory.set, etc.) - for persistent state within a session
  * See specific tool documentation for available runtime capabilities
```

**Note**: The hosting application (e.g., Sitegeist's `AgentInterface`) is responsible for creating the runtime providers factory:

```typescript
// In Sitegeist's AgentInterface or similar
artifactsPanel.runtimeProvidersFactory = () => {
  const providers: SandboxRuntimeProvider[] = [];

  // Console provider is REQUIRED and should always be first
  providers.push(new ConsoleRuntimeProvider());

  // Add attachments provider
  const attachments = this.getAttachments(); // however attachments are obtained
  providers.push(new AttachmentsRuntimeProvider(attachments));

  // Add memory provider (in Sitegeist)
  const sessionId = this.getCurrentSessionId();
  const memorySnapshot = await this.getMemorySnapshot(sessionId);
  providers.push(new MemoryRuntimeProvider(sessionId, memorySnapshot));

  // Add any other providers...

  return providers;
};
```

### 8. Create SandboxMessageRouter

**New File**: `packages/web-ui/src/components/sandbox/SandboxMessageRouter.ts`

This is the **core** of the centralized message handling system. It replaces all individual `window.addEventListener("message", ...)` calls.

```typescript
/**
 * Message consumer interface - components that want to receive messages from sandboxes
 */
export interface MessageConsumer {
  handleMessage(message: any): boolean; // Return true if message was consumed
}

/**
 * Sandbox context - tracks active sandboxes and their consumers
 */
interface SandboxContext {
  sandboxId: string;
  iframe: HTMLIFrameElement | null; // null until setSandboxIframe()
  providers: SandboxRuntimeProvider[];
  consumers: Set<MessageConsumer>;
}

/**
 * Centralized message router for all sandbox communication.
 *
 * This singleton replaces all individual window.addEventListener("message") calls
 * with a single global listener that routes messages to the appropriate handlers.
 *
 * Benefits:
 * - Single global listener instead of multiple independent listeners
 * - Automatic cleanup when sandboxes are destroyed
 * - Support for bidirectional communication (providers) and broadcasting (consumers)
 * - Clear lifecycle management
 */
export class SandboxMessageRouter {
  private sandboxes = new Map<string, SandboxContext>();
  private messageListener: ((e: MessageEvent) => void) | null = null;

  /**
   * Register a new sandbox with its runtime providers.
   * Call this BEFORE creating the iframe.
   */
  registerSandbox(sandboxId: string, providers: SandboxRuntimeProvider[]): void {
    this.sandboxes.set(sandboxId, {
      sandboxId,
      iframe: null, // Will be set via setSandboxIframe()
      providers,
      consumers: new Set()
    });

    // Setup global listener if not already done
    this.setupListener();
  }

  /**
   * Update the iframe reference for a sandbox.
   * Call this AFTER creating the iframe.
   * This is needed so providers can send responses back to the sandbox.
   */
  setSandboxIframe(sandboxId: string, iframe: HTMLIFrameElement): void {
    const context = this.sandboxes.get(sandboxId);
    if (context) {
      context.iframe = iframe;
    }
  }

  /**
   * Unregister a sandbox and remove all its consumers.
   * Call this when the sandbox is destroyed.
   */
  unregisterSandbox(sandboxId: string): void {
    this.sandboxes.delete(sandboxId);

    // If no more sandboxes, remove global listener
    if (this.sandboxes.size === 0 && this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
  }

  /**
   * Add a message consumer for a sandbox.
   * Consumers receive broadcast messages (console, execution-complete, etc.)
   */
  addConsumer(sandboxId: string, consumer: MessageConsumer): void {
    const context = this.sandboxes.get(sandboxId);
    if (context) {
      context.consumers.add(consumer);
    }
  }

  /**
   * Remove a message consumer from a sandbox.
   */
  removeConsumer(sandboxId: string, consumer: MessageConsumer): void {
    const context = this.sandboxes.get(sandboxId);
    if (context) {
      context.consumers.delete(consumer);
    }
  }

  /**
   * Setup the global message listener (called automatically)
   */
  private setupListener(): void {
    if (this.messageListener) return;

    this.messageListener = (e: MessageEvent) => {
      const { sandboxId } = e.data;
      if (!sandboxId) return;

      const context = this.sandboxes.get(sandboxId);
      if (!context) return;

      // Create respond() function for bidirectional communication
      const respond = (response: any) => {
        if (!response.sandboxId) response.sandboxId = sandboxId;
        context.iframe?.contentWindow?.postMessage(response, "*");
      };

      // 1. Try provider handlers first (for bidirectional comm like memory)
      for (const provider of context.providers) {
        if (provider.handleMessage) {
          const handled = provider.handleMessage(e.data, respond);
          if (handled) return; // Stop if handled
        }
      }

      // 2. Broadcast to consumers (for one-way messages like console)
      for (const consumer of context.consumers) {
        const consumed = consumer.handleMessage(e.data);
        if (consumed) break; // Stop if consumed
      }
    };

    window.addEventListener("message", this.messageListener);
  }
}

/**
 * Global singleton instance.
 * Import this from SandboxedIframe.ts or wherever needed.
 */
export const SANDBOX_MESSAGE_ROUTER = new SandboxMessageRouter();
```

**Key concepts**:
- **Providers** handle bidirectional communication (memory requests/responses) via `handleMessage(message, respond)`
- **Consumers** receive broadcast messages (console logs, execution-complete) via `handleMessage(message)`
- **Lifecycle**: Register sandbox → set iframe → add consumers → remove consumers → unregister sandbox
- **respond()** is a closure that captures the iframe reference and sends messages back to the sandbox

---

### 9. Update SandboxedIframe to Use Router

**File**: `packages/web-ui/src/components/SandboxedIframe.ts`

#### Changes:

**Import the router:**
```typescript
import { SANDBOX_MESSAGE_ROUTER, MessageConsumer } from "./sandbox/SandboxMessageRouter.js";
```

**Update `execute()` to use router:**
```typescript
private currentSandboxId: string | null = null;

public async execute(
  sandboxId: string,
  code: string,
  providers: SandboxRuntimeProvider[] = [],
  signal?: AbortSignal,
): Promise<SandboxResult> {
  this.currentSandboxId = sandboxId;

  // 1. Register sandbox with providers BEFORE creating iframe
  SANDBOX_MESSAGE_ROUTER.registerSandbox(sandboxId, providers);

  // 2. Collect results
  const logs: Array<{ type: string; text: string }> = [];
  const files: SandboxFile[] = [];
  let completed = false;

  return new Promise((resolve, reject) => {
    // 3. Create execution consumer for lifecycle messages
    const executionConsumer: MessageConsumer = {
      handleMessage(message: any): boolean {
        if (message.type === "console") {
          logs.push({
            type: message.method === "error" ? "error" : "log",
            text: message.text
          });
          return true;
        } else if (message.type === "file-returned") {
          files.push({
            fileName: message.fileName,
            content: message.content,
            mimeType: message.mimeType
          });
          return true;
        } else if (message.type === "execution-complete") {
          completed = true;
          cleanup();
          resolve({ success: true, console: logs, files });
          return true;
        } else if (message.type === "execution-error") {
          completed = true;
          cleanup();
          resolve({ success: false, console: logs, error: message.error, files });
          return true;
        }
        return false;
      }
    };

    SANDBOX_MESSAGE_ROUTER.addConsumer(sandboxId, executionConsumer);

    const cleanup = () => {
      SANDBOX_MESSAGE_ROUTER.removeConsumer(sandboxId, executionConsumer);
      SANDBOX_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
      signal?.removeEventListener("abort", abortHandler);
      clearTimeout(timeoutId);
      this.iframe?.remove();
      this.iframe = null;
    };

    // 4. Create iframe
    const completeHtml = this.prepareHtmlDocument(sandboxId, code, providers);
    this.iframe = document.createElement("iframe");
    this.iframe.sandbox.add(
      "allow-scripts",
      "allow-same-origin"
    );
    this.iframe.srcdoc = completeHtml;
    this.iframe.style.display = "none";
    this.appendChild(this.iframe);

    // 5. Update router with iframe reference
    SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);

    // ... abort handler, timeout handler ...
  });
}
```

**Update `loadContent()` to use router:**
```typescript
public loadContent(
  sandboxId: string,
  htmlContent: string,
  providers: SandboxRuntimeProvider[] = []
): void {
  this.currentSandboxId = sandboxId;

  // Register sandbox - will live until disconnectedCallback
  SANDBOX_MESSAGE_ROUTER.registerSandbox(sandboxId, providers);

  const completeHtml = this.prepareHtmlDocument(sandboxId, htmlContent, providers);

  // Remove previous iframe if exists
  if (this.iframe) {
    this.iframe.remove();
  }

  // Create iframe
  if (this.sandboxUrlProvider) {
    // Use sandboxUrlProvider pattern (for browser extensions)
    this.loadViaSandboxUrl(sandboxId, completeHtml);
  } else {
    // Direct srcdoc
    this.iframe = document.createElement("iframe");
    this.iframe.sandbox.add("allow-scripts", "allow-same-origin");
    this.iframe.srcdoc = completeHtml;
    this.iframe.style.cssText = "width: 100%; height: 100%; border: none;";
    this.appendChild(this.iframe);

    // Update router with iframe reference
    SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);
  }
}
```

**Update `loadViaSandboxUrl()` to use router:**
```typescript
private loadViaSandboxUrl(sandboxId: string, completeHtml: string): void {
  const sandboxUrl = this.sandboxUrlProvider!();

  // Create consumer for sandbox-ready message
  const readyConsumer: MessageConsumer = {
    handleMessage: (message: any): boolean => {
      if (message.type === "sandbox-ready" && message.source === "sandbox") {
        // Remove consumer after one message
        SANDBOX_MESSAGE_ROUTER.removeConsumer(sandboxId, readyConsumer);

        // Send content to sandbox
        this.iframe?.contentWindow?.postMessage({
          type: "sandbox-load",
          sandboxId,
          code: completeHtml
        }, "*");

        return true;
      }
      return false;
    }
  };

  SANDBOX_MESSAGE_ROUTER.addConsumer(sandboxId, readyConsumer);

  // Create iframe pointing to sandbox URL
  this.iframe = document.createElement("iframe");
  this.iframe.src = sandboxUrl;
  this.iframe.style.cssText = "width: 100%; height: 100%; border: none;";
  this.appendChild(this.iframe);

  // Update router with iframe reference
  SANDBOX_MESSAGE_ROUTER.setSandboxIframe(sandboxId, this.iframe);
}
```

**Update `disconnectedCallback()`:**
```typescript
override disconnectedCallback() {
  super.disconnectedCallback();

  // Cleanup: Unregister sandbox (removes all consumers too!)
  if (this.currentSandboxId) {
    SANDBOX_MESSAGE_ROUTER.unregisterSandbox(this.currentSandboxId);
    this.currentSandboxId = null;
  }

  this.iframe?.remove();
  this.iframe = null;
}
```

**Remove old message handling code:**
- Remove all direct `window.addEventListener("message", ...)` calls
- Remove all `window.removeEventListener("message", ...)` calls
- Remove `messageHandler` properties

---

### 10. Update ArtifactsPanel.waitForHtmlExecution()

**File**: `packages/web-ui/src/tools/artifacts/artifacts.ts`

**Current implementation** (lines 410-459) uses direct `addEventListener`. Replace with router:

```typescript
private async waitForHtmlExecution(artifact: HtmlArtifact): Promise<void> {
  return new Promise((resolve) => {
    const sandboxId = `artifact-${artifact.filename}`;
    let resolved = false;

    const consumer: MessageConsumer = {
      handleMessage: (message: any): boolean => {
        if (message.type === "execution-complete") {
          if (!resolved) {
            resolved = true;
            // Cleanup is CRITICAL: remove consumer and timeout
            SANDBOX_MESSAGE_ROUTER.removeConsumer(sandboxId, consumer);
            clearTimeout(timeoutId);
            resolve();
          }
          return true;
        }
        return false;
      }
    };

    SANDBOX_MESSAGE_ROUTER.addConsumer(sandboxId, consumer);

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Timeout hit before message - cleanup and resolve anyway
        SANDBOX_MESSAGE_ROUTER.removeConsumer(sandboxId, consumer);
        resolve();
      }
    }, 1500);
  });
}
```

**Key difference from your concern**: "What if timeout is hit and then handleMessage comes in?"

Answer: **It can't happen** because:
1. If timeout hits first: `resolved = true`, consumer is removed via `removeConsumer()`
2. Router no longer calls consumer's `handleMessage()` because it's been removed
3. If message arrives later, consumer is not in the consumers set, so it won't be called

The cleanup happens **synchronously** in the timeout, so there's no race condition.

---

### 11. Update JavaScript REPL Tool

**File**: `packages/web-ui/src/tools/javascript-repl.ts`

#### Changes:

**Update `executeJavaScript()` function to pass providers to execute():**
```typescript
export async function executeJavaScript(
  code: string,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
  sandboxUrlProvider?: () => string,
): Promise<{ output: string; files?: SandboxFile[] }> {
  // ... existing checks ...

  // Create a SandboxedIframe instance for execution
  const sandbox = new SandboxIframe();

  if (sandboxUrlProvider) {
    sandbox.sandboxUrlProvider = sandboxUrlProvider;
  }
  sandbox.style.display = "none";
  document.body.appendChild(sandbox);

  try {
    const sandboxId = `repl-${Date.now()}`;

    // Build runtime providers
    const runtimeProviders: SandboxRuntimeProvider[] = [
      new ConsoleRuntimeProvider(),  // REQUIRED
      new AttachmentsRuntimeProvider(attachments)
    ];

    // TODO: Add memory runtime provider when available
    // runtimeProviders.push(new MemoryRuntimeProvider(sessionId, memorySnapshot));

    // Pass providers to execute (router handles all message routing)
    const result: SandboxResult = await sandbox.execute(sandboxId, code, runtimeProviders, signal);

    // ... rest stays the same
  }
}
```

**Note**: No message handling code needed! The router and ConsoleRuntimeProvider handle everything.

## Benefits of This Approach

### 1. **Extensibility**
Adding new runtime capabilities is trivial:
```typescript
// New feature? Just create a provider!
class SkillsRuntimeProvider implements SandboxRuntimeProvider {
  getData() { return { skills: this.skills }; }
  getRuntime() { return (sandboxId) => { /* skill API */ }; }
}
```

### 2. **Separation of Concerns**
- `SandboxedIframe` doesn't know about attachments, memory, or skills
- Each feature is self-contained in its provider
- Easy to test providers in isolation

### 3. **Composability**
```typescript
sandbox.runtimeProviders = [
  new AttachmentsRuntimeProvider(attachments),
  new MemoryRuntimeProvider(sessionId, memorySnapshot),
  new SkillsRuntimeProvider(skills),
  new CustomFeatureProvider(...)
];
```

### 4. **Backward Compatibility**
Existing code works by migrating to `AttachmentsRuntimeProvider` - no breaking changes to public API.

### 5. **Self-Contained Artifacts**
Memory provider with snapshot fallback means downloaded artifacts still work offline with degraded functionality.

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create `SandboxRuntimeProvider` interface
- [ ] Create `SandboxMessageRouter` class and singleton instance
- [ ] Create `ConsoleRuntimeProvider` (extracts existing console/error handling code)
- [ ] Create `AttachmentsRuntimeProvider` (extracts existing attachment helper functions)
- [ ] Refactor `SandboxedIframe.getRuntimeScript()` to use providers
- [ ] Make `SandboxedIframe.prepareHtmlDocument()` public (for download button)
- [ ] Update `SandboxedIframe.execute()` to use router and providers
- [ ] Update `SandboxedIframe.loadContent()` to use router and providers
- [ ] Update `SandboxedIframe.loadViaSandboxUrl()` to use router
- [ ] Update `SandboxedIframe.disconnectedCallback()` to cleanup router
- [ ] Remove all direct `addEventListener("message")` calls from SandboxedIframe
- [ ] Test REPL with new provider system

### Phase 2: Migrate Consumers
- [ ] Remove `attachments` property from `HtmlArtifact`, add `runtimeProviders` property
- [ ] Update `HtmlArtifact.executeContent()` to use router instead of addEventListener
- [ ] Update `HtmlArtifact.disconnectedCallback()` to cleanup router consumer
- [ ] Update `HtmlArtifact.getHeaderButtons()` to use prepareHtmlDocument for downloads
- [ ] Replace `attachmentsProvider` with `runtimeProvidersFactory` in `ArtifactsPanel`
- [ ] Update `ArtifactsPanel.getOrCreateArtifactElement()` to use factory
- [ ] Update `ArtifactsPanel.waitForHtmlExecution()` to use router
- [ ] Update `javascript-repl.ts` to pass providers to execute()
- [ ] Test artifacts with attachments still work
- [ ] Test REPL with attachments still works
- [ ] Test downloaded artifacts contain runtime code and work standalone

### Phase 3: Add Memory Support
- [ ] Create `MemoryRuntimeProvider` with handleMessage() for memory requests
- [ ] Update hosting application to include memory provider in factory
- [ ] Update `javascript-repl.ts` to include memory provider
- [ ] Test memory persistence in REPL
- [ ] Test memory persistence in HTML artifacts
- [ ] Test memory snapshot fallback when running standalone
- [ ] Test downloaded artifacts with memory snapshot work offline

### Phase 4: Browser JavaScript Tool (Separate)
- [ ] Memory for browser_javascript uses `chrome.runtime.sendMessage()` (different pattern)
- [ ] Already documented in `memories.md`
- [ ] No changes needed to sandbox system

## Summary: What Gets Extracted into Providers

The current `getRuntimeScript()` monolithic function contains two distinct pieces of functionality that become providers:

### 1. ConsoleRuntimeProvider (REQUIRED)
**Extracted from**: Lines 398-513 of current `SandboxedIframe.getRuntimeScript()`

**Provides:**
- Console capture (log, error, warn, info)
- Error event handlers (error, unhandledrejection)
- `complete()` method for execution lifecycle
- `execution-complete` and `execution-error` postMessage events

**Why required:** Every sandbox needs console logging and error handling. This provider should always be included first.

### 2. AttachmentsRuntimeProvider (OPTIONAL)
**Extracted from**: Lines 328-396 of current `SandboxedIframe.getRuntimeScript()`

**Provides:**
- `listFiles()` - List available attachments
- `readTextFile(id)` - Read text attachment
- `readBinaryFile(id)` - Read binary attachment as Uint8Array
- `returnFile(name, content, mimeType)` - Return file from sandbox to parent

**Why optional:** Only needed when attachments are present.

### 3. MemoryRuntimeProvider (OPTIONAL - NEW)
**Provides:**
- `memory.get(key)` - Get memory value with snapshot fallback
- `memory.set(key, value)` - Set memory value
- `memory.has(key)`, `memory.delete(key)`, `memory.clear()`, `memory.keys()`

**Why optional:** Only needed for stateful JavaScript execution (REPL, HTML artifacts).

## Future Extensions

With this pattern, we can easily add:

1. **Skills Runtime Provider**: Inject domain-specific function libraries
2. **Storage Runtime Provider**: Controlled access to localStorage/IndexedDB
3. **Network Runtime Provider**: Fetch proxy with rate limiting
4. **Custom API Runtime Provider**: Any app-specific APIs

Each is just a new class implementing `SandboxRuntimeProvider`!

---

## Complete Architecture Summary

### The Big Picture

**Problem**: Need to inject runtime capabilities (attachments, memory, etc.) into sandboxed iframes, with centralized message handling and clear lifecycle management.

**Solution**: Runtime Provider Pattern + Message Router

### Three Core Pieces

#### 1. Runtime Providers (Data + Code Injection)
```typescript
interface SandboxRuntimeProvider {
  getData(): Record<string, any>;              // Data to inject
  getRuntime(): (sandboxId: string) => void;   // Code to inject
  handleMessage?(message, respond): boolean;   // Optional: handle requests
}
```

**Three providers**:
- **ConsoleRuntimeProvider** (REQUIRED) - Console capture, error handling, complete() method
- **AttachmentsRuntimeProvider** (OPTIONAL) - File access APIs
- **MemoryRuntimeProvider** (OPTIONAL) - Memory persistence APIs

#### 2. Message Router (Centralized Communication)
```typescript
class SandboxMessageRouter {
  registerSandbox(sandboxId, providers)    // Before iframe creation
  setSandboxIframe(sandboxId, iframe)      // After iframe creation
  unregisterSandbox(sandboxId)             // On sandbox destruction
  addConsumer(sandboxId, consumer)         // Add message listener
  removeConsumer(sandboxId, consumer)      // Remove message listener
}
```

**Single global listener** replaces all individual `addEventListener("message")` calls.

#### 3. Message Patterns

**Pattern A: Bidirectional (Request/Response)**
- Use case: Sandbox needs data FROM extension (memory get/set)
- Provider implements `handleMessage(message, respond)`
- Sandbox sends request with unique requestId, waits for response
- Flow: Sandbox → Router → Provider → respond() → Router → Sandbox

**Pattern B: Broadcast (One-way)**
- Use case: Sandbox sends events TO extension (console logs, errors)
- Consumers register via `addConsumer()`
- All consumers receive all messages
- Flow: Sandbox → Router → All Consumers

### Key Lifecycle Flows

**REPL Execution (One-shot)**:
```
1. execute(sandboxId, code, providers)
2. Router: registerSandbox(sandboxId, providers)
3. Create iframe
4. Router: setSandboxIframe(sandboxId, iframe)
5. Router: addConsumer(sandboxId, executionConsumer)  // For lifecycle messages
6. ... execution happens ...
7. Consumer receives execution-complete
8. Router: removeConsumer(sandboxId, executionConsumer)
9. Router: unregisterSandbox(sandboxId)
10. Remove iframe
```

**HTML Artifact (Persistent)**:
```
1. loadContent(sandboxId, html, providers)
2. Router: registerSandbox(sandboxId, providers)
3. Create iframe
4. Router: setSandboxIframe(sandboxId, iframe)
5. Router: addConsumer(sandboxId, artifactConsumer)  // For console messages
6. ... artifact lives in panel, can send messages any time ...
7. User closes artifact
8. disconnectedCallback()
9. Router: removeConsumer(sandboxId, artifactConsumer)
10. Router: unregisterSandbox(sandboxId)
11. Remove iframe
```

**Memory Request Flow**:
```
1. LLM code: await memory.get('key')
2. Sandbox: postMessage({ type: 'memory_get', sandboxId, requestId, key })
3. Router: Receives message, finds sandbox context
4. Router: Calls MemoryRuntimeProvider.handleMessage(message, respond)
5. Provider: Fetches from IndexedDB
6. Provider: respond({ type: 'memory_response', requestId, value })
7. Router's respond(): context.iframe.contentWindow.postMessage(response)
8. Sandbox: Receives response, matches requestId, resolves promise
9. LLM code: Receives value
```

### Files Modified/Created

**Created**:
- `packages/web-ui/src/components/sandbox/SandboxRuntimeProvider.ts` - Interface
- `packages/web-ui/src/components/sandbox/SandboxMessageRouter.ts` - Router + singleton
- `packages/web-ui/src/components/sandbox/ConsoleRuntimeProvider.ts` - Console runtime
- `packages/web-ui/src/components/sandbox/AttachmentsRuntimeProvider.ts` - Attachment runtime
- `packages/web-ui/src/components/sandbox/MemoryRuntimeProvider.ts` - Memory runtime (Phase 3)

**Modified**:
- `packages/web-ui/src/components/SandboxedIframe.ts` - Use providers + router, make prepareHtmlDocument public
- `packages/web-ui/src/tools/artifacts/HtmlArtifact.ts` - Use runtimeProviders + router, fix download button
- `packages/web-ui/src/tools/artifacts/artifacts.ts` - Use runtimeProvidersFactory + router
- `packages/web-ui/src/tools/javascript-repl.ts` - Pass providers to execute()
- Hosting application (e.g., Sitegeist's AgentInterface) - Create runtimeProvidersFactory

### Critical Questions Answered

**Q: How does download button work?**
A: Calls `sandbox.prepareHtmlDocument(sandboxId, html, providers)` to generate standalone HTML with all runtime code injected. Downloaded artifacts work offline with degraded functionality (memory falls back to snapshot).

**Q: How does waitForHtmlExecution work?**
A: Uses router.addConsumer() instead of addEventListener. Cleanup is race-condition-free because removeConsumer() happens synchronously in timeout or message handler.

**Q: When are listeners cleaned up?**
A:
- execute(): After completion/error/abort/timeout
- loadContent(): When artifact is closed (disconnectedCallback)
- waitForHtmlExecution(): After execution-complete or 1500ms timeout
- Router itself: Removes global listener when sandboxes.size === 0

**Q: Can multiple artifacts use memory simultaneously?**
A: Yes! Each has its own sandboxId, router routes messages correctly.

**Q: What happens on session change?**
A: If sidepanel reloads URL, all listeners are automatically cleaned up. If not, need to hook session change and call router.unregisterSandbox() for all active sandboxes.

### Migration Strategy

**Phase 1**: Build infrastructure (providers, router) without breaking existing code
**Phase 2**: Migrate consumers one by one, test thoroughly
**Phase 3**: Add memory support using established patterns
**Phase 4**: Browser JavaScript tool uses separate pattern (chrome.runtime.sendMessage)

### Success Criteria

✅ Single global message listener for entire application
✅ No memory leaks (all cleanup guaranteed via router)
✅ Extensible (new providers are trivial to add)
✅ Self-contained artifacts (downloaded HTML works standalone)
✅ Clear lifecycle (register → use → cleanup)
✅ Support for both bidirectional (memory) and broadcast (console) communication
