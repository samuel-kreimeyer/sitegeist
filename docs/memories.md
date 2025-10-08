# Memory API for JavaScript Execution

## Overview

The Memory API provides **session-scoped persistent storage** for LLM-generated JavaScript code across three execution contexts:

1. **browser_javascript tool** - Code running in actual web pages via userScripts
2. **javascript_repl tool** - Code running in sandboxed iframes (web-ui)
3. **HTMLArtifact** - HTML artifacts with embedded JavaScript (web-ui)

All three contexts share the same memory API, allowing the AI model to store and retrieve data across page navigations, REPL executions, and artifact reruns.

## The Problem

When the model needs to collect data from multiple executions (e.g., "fetch all video transcripts from this playlist" or "process data across multiple REPL runs"), it faces a challenge:

1. Execute code on page 1, extract data
2. Navigate to page 2 / Run new REPL → **execution context destroyed, data lost!**
3. Execute code on page 3 → no way to access data from previous executions

Traditional solutions don't work across all contexts:
- `localStorage` pollutes the website's storage, persists beyond the session, and doesn't work in sandboxed iframes
- `sessionStorage` is tied to the tab and doesn't work in sandboxed iframes
- Extension APIs like `chrome.storage` are not accessible from sandboxed iframes or user scripts

## The Solution: Memory API

A session-scoped storage API that:
- **Persists across executions** within the same conversation
- **Is isolated per session** (different conversations don't interfere)
- **Uses IndexedDB** in the extension context to handle potentially large datasets
- **Automatically serializes/deserializes** JSON for convenience
- **Works identically** across all three execution contexts

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│              User Script / Sandboxed Iframe                 │
│                   (Isolated execution context)              │
│                                                             │
│  const products = await memory.get('products') || [];       │
│  products.push(newProduct);                                 │
│  await memory.set('products', products);                    │
│             ↓                                               │
│  Sends message via:                                         │
│  - chrome.runtime.sendMessage() (user scripts)             │
│  - window.parent.postMessage() (sandboxed iframes)         │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    Message Handler Layer
                              ↓
┌─────────────────────────────────────────────────────────────┐
│        Message Handler (Extension Context)                  │
│    - browser-javascript.ts for user scripts                │
│    - SandboxedIframe.ts for REPL/artifacts                 │
│                                                             │
│  Handler receives message and calls:                        │
│    const memories = getSitegeistStorage().memories          │
│    await memories.set(sessionId, msg.key, msg.value)        │
│    sendResponse({ success: true })                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    MemoriesStore (Store pattern)
                              ↓
                   IndexedDBStorageBackend
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        IndexedDB                            │
│                    (sitegeist-storage)                      │
│                                                             │
│  Object Store: memories                                     │
│  Key: `${sessionId}_${key}`                                 │
│  Value: JSON.stringify(data)                                │
│                                                             │
│  - Handles large datasets (GB range)                        │
│  - Persists across navigations and browser restarts         │
│  - Scoped to session                                        │
└─────────────────────────────────────────────────────────────┘
```

### Context-Specific Implementations

#### 1. Browser JavaScript Tool (User Scripts)

**Execution Context**: Actual web pages via `browser.userScripts.execute()`

**Communication**: User script → `chrome.runtime.sendMessage()` → Extension background → Response

**File**: `src/tools/browser-javascript.ts`

**How it works**:
- Code runs in USER_SCRIPT world on the actual web page
- Memory API uses `chrome.runtime.sendMessage()` to communicate with extension
- Extension processes messages and calls `MemoriesStore`
- Response sent back via `sendResponse()` callback

**Limitations**: Only available in browser extensions, not web apps

#### 2. JavaScript REPL Tool (Sandboxed Iframe)

**Execution Context**: Sandboxed iframe (no network access, isolated from parent)

**Communication**: Iframe → `window.parent.postMessage()` → SandboxedIframe → Response via `postMessage`

**Files**:
- `packages/web-ui/src/tools/javascript-repl.ts` - Tool definition
- `packages/web-ui/src/components/SandboxedIframe.ts` - Sandbox management

**How it works**:
- Code runs in sandboxed iframe with `allow-scripts` permission
- Memory API uses `window.parent.postMessage()` to communicate with parent
- Parent window (`SandboxedIframe`) processes messages and calls `MemoriesStore`
- Response sent back via `iframe.contentWindow.postMessage()`

**Special consideration**: Works in both web apps and extensions (requires proper session ID handling)

#### 3. HTML Artifacts (Sandboxed Iframe)

**Execution Context**: Same as REPL - sandboxed iframe

**Communication**: Identical to REPL

**Files**:
- `packages/web-ui/src/artifacts/HTMLArtifact.ts` - Artifact rendering
- `packages/web-ui/src/components/SandboxedIframe.ts` - Shared sandbox

**How it works**:
- HTML content with embedded JavaScript runs in sandboxed iframe
- Memory API injected via runtime script (same as REPL)
- Communication identical to REPL

**Use case**: Persistent state for interactive HTML artifacts (e.g., counters, form state, game progress)

## File Structure

### Core Storage (Unified Store Pattern)

**Web-UI (shared infrastructure):**
- `packages/web-ui/src/storage/store.ts` - Base `Store` class
- `packages/web-ui/src/storage/storage-backend.ts` - `StorageBackend` interface
- `packages/web-ui/src/storage/backends/indexeddb-storage-backend.ts` - IndexedDB implementation
- `packages/web-ui/src/storage/app-storage.ts` - Base `AppStorage` class

**Sitegeist (memory-specific):**
- `src/storage/stores/memories-store.ts` - `MemoriesStore` class (extends `Store`)
- `src/storage/app-storage.ts` - `SitegeistAppStorage` (extends `AppStorage`, adds memories)

### Context-Specific Implementation

**Browser JavaScript Tool:**
- `src/tools/browser-javascript.ts` - Tool + message handler + memory injection

**JavaScript REPL & HTML Artifacts:**
- `packages/web-ui/src/components/SandboxedIframe.ts` - Sandbox + message handler + memory injection
- `packages/web-ui/src/tools/javascript-repl.ts` - Tool definition
- `packages/web-ui/src/artifacts/HTMLArtifact.ts` - Artifact rendering

## Implementation Details

### 1. Storage Layer (Store Pattern)

Uses the unified Store pattern described in [storage.md](storage.md).

#### MemoriesStore

**File**: `src/storage/stores/memories-store.ts`

```typescript
import { Store, type StoreConfig } from "@mariozechner/pi-web-ui";

export class MemoriesStore extends Store {
  getConfig(): StoreConfig {
    return {
      name: 'memories',
      // No keyPath - uses out-of-line keys (string keys like "session123_mykey")
    };
  }

  private makeKey(sessionId: string, key: string): string {
    return `${sessionId}_${key}`;
  }

  async get(sessionId: string, key: string): Promise<string | null> {
    return this.getBackend().get('memories', this.makeKey(sessionId, key));
  }

  async set(sessionId: string, key: string, value: string): Promise<void> {
    await this.getBackend().set('memories', this.makeKey(sessionId, key), value);
  }

  async delete(sessionId: string, key: string): Promise<void> {
    await this.getBackend().delete('memories', this.makeKey(sessionId, key));
  }

  async has(sessionId: string, key: string): Promise<boolean> {
    const value = await this.get(sessionId, key);
    return value !== null;
  }

  async keys(sessionId: string): Promise<string[]> {
    const prefix = `${sessionId}_`;
    const allKeys = await this.getBackend().keys('memories', prefix);
    // Strip session prefix to return just the user keys
    return allKeys.map(k => k.substring(prefix.length));
  }

  async clear(sessionId: string): Promise<void> {
    const userKeys = await this.keys(sessionId);
    const backend = this.getBackend();

    // Use transaction for atomic clear
    await backend.transaction(['memories'], 'readwrite', async (tx) => {
      for (const userKey of userKeys) {
        await tx.delete('memories', this.makeKey(sessionId, userKey));
      }
    });
  }
}
```

#### SitegeistAppStorage Integration

**File**: `src/storage/app-storage.ts`

```typescript
import { AppStorage as BaseAppStorage, SettingsStore, ProviderKeysStore, SessionsStore, IndexedDBStorageBackend } from "@mariozechner/pi-web-ui";
import { SkillsStore } from "./stores/skills-store.js";
import { MemoriesStore } from "./stores/memories-store.js";

export class SitegeistAppStorage extends BaseAppStorage {
  readonly memories: MemoriesStore;
  readonly skills: SkillsStore;

  constructor() {
    // 1. Create all stores (no backend yet)
    const settings = new SettingsStore();
    const providerKeys = new ProviderKeysStore();
    const sessions = new SessionsStore();
    const memories = new MemoriesStore();
    const skills = new SkillsStore();

    // 2. Gather configs from all stores
    const configs = [
      settings.getConfig(),
      providerKeys.getConfig(),
      sessions.getConfig(),
      memories.getConfig(),
      skills.getConfig(),
    ];

    // 3. Create backend with all configs
    const backend = new IndexedDBStorageBackend({
      dbName: 'sitegeist-storage',
      version: 1,
      stores: configs,
    });

    // 4. Wire backend to all stores
    settings.setBackend(backend);
    providerKeys.setBackend(backend);
    sessions.setBackend(backend);
    memories.setBackend(backend);
    skills.setBackend(backend);

    // 5. Pass base stores to parent
    super(settings, providerKeys, sessions);

    // 6. Store references to sitegeist-specific stores
    this.memories = memories;
    this.skills = skills;
  }

  /**
   * Override deleteSession to also clear memories for this session.
   */
  override async deleteSession(sessionId: string): Promise<void> {
    // Delete session data first
    await super.deleteSession(sessionId);

    // Then delete all memories for this session
    await this.memories.clear(sessionId);
  }
}

/**
 * Helper to get typed Sitegeist storage.
 */
export function getSitegeistStorage(): SitegeistAppStorage {
  const storage = getAppStorage();
  if (!(storage instanceof SitegeistAppStorage)) {
    throw new Error('Expected SitegeistAppStorage instance');
  }
  return storage;
}
```

**Initialization** (in `src/sidepanel.ts`):
```typescript
import { setAppStorage } from "@mariozechner/pi-web-ui";
import { SitegeistAppStorage } from "./storage/app-storage.js";

// Create and register storage
const storage = new SitegeistAppStorage();
setAppStorage(storage);
```

### 2. Browser JavaScript Tool Implementation

**File**: `src/tools/browser-javascript.ts`

#### Message Protocol for User Scripts

```typescript
// Message types sent via chrome.runtime.sendMessage()
{ type: 'memory_set', key: string, value: string }      // Response: { success: boolean, error?: string }
{ type: 'memory_get', key: string }                     // Response: { value?: string, error?: string }
{ type: 'memory_has', key: string }                     // Response: { exists: boolean, error?: string }
{ type: 'memory_delete', key: string }                  // Response: { success: boolean, error?: string }
{ type: 'memory_clear' }                                // Response: { success: boolean, error?: string }
{ type: 'memory_keys' }                                 // Response: { keys: string[], error?: string }
```

#### Message Handler Registration

Add near the top of `browser-javascript.ts` after imports:

```typescript
import { getSitegeistStorage } from "../storage/app-storage.js";

function getCurrentSessionId(): string {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  if (!sessionId) {
    throw new Error('Session ID not available - sidepanel must be opened with ?session=<id>');
  }

  return sessionId;
}

// Register message handler (call this during module initialization)
function registerMemoryMessageHandler() {
  browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Only handle memory messages
    if (!message.type?.startsWith('memory_')) {
      return; // Let other handlers process this
    }

    const sessionId = getCurrentSessionId();
    const memories = getSitegeistStorage().memories;

    (async () => {
      try {
        switch (message.type) {
          case 'memory_set':
            await memories.set(sessionId, message.key, message.value);
            sendResponse({ success: true });
            break;

          case 'memory_get':
            const value = await memories.get(sessionId, message.key);
            sendResponse({ value });
            break;

          case 'memory_has':
            const exists = await memories.has(sessionId, message.key);
            sendResponse({ exists });
            break;

          case 'memory_delete':
            await memories.delete(sessionId, message.key);
            sendResponse({ success: true });
            break;

          case 'memory_clear':
            await memories.clear(sessionId);
            sendResponse({ success: true });
            break;

          case 'memory_keys':
            const keys = await memories.keys(sessionId);
            sendResponse({ keys });
            break;

          default:
            sendResponse({ error: 'Unknown memory operation' });
        }
      } catch (error: any) {
        sendResponse({ error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  });
}

// Call during module initialization
registerMemoryMessageHandler();
```

#### Memory API Injection in User Scripts

Update `wrapperFunction()` to inject memory API:

```typescript
async function wrapperFunction() {
  // ... existing console capture code ...

  // Create memory object for persisting data across navigations
  // @ts-expect-error - chrome global is injected
  const chromeAPI = typeof chrome !== "undefined" ? chrome : null;

  if (chromeAPI?.runtime) {
    (window as any).memory = {
      async set(key: string, value: any): Promise<void> {
        const stringified = JSON.stringify(value);
        return new Promise((resolve, reject) => {
          chromeAPI.runtime.sendMessage(
            {
              type: 'memory_set',
              key,
              value: stringified
            },
            (response) => {
              if (chromeAPI.runtime.lastError) {
                reject(new Error(chromeAPI.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve();
              }
            }
          );
        });
      },

      async get(key: string): Promise<any> {
        return new Promise((resolve, reject) => {
          chromeAPI.runtime.sendMessage(
            {
              type: 'memory_get',
              key
            },
            (response) => {
              if (chromeAPI.runtime.lastError) {
                reject(new Error(chromeAPI.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve(response?.value ? JSON.parse(response.value) : undefined);
              }
            }
          );
        });
      },

      async has(key: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
          chromeAPI.runtime.sendMessage(
            {
              type: 'memory_has',
              key
            },
            (response) => {
              if (chromeAPI.runtime.lastError) {
                reject(new Error(chromeAPI.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve(response?.exists || false);
              }
            }
          );
        });
      },

      async delete(key: string): Promise<void> {
        return new Promise((resolve, reject) => {
          chromeAPI.runtime.sendMessage(
            {
              type: 'memory_delete',
              key
            },
            (response) => {
              if (chromeAPI.runtime.lastError) {
                reject(new Error(chromeAPI.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve();
              }
            }
          );
        });
      },

      async clear(): Promise<void> {
        return new Promise((resolve, reject) => {
          chromeAPI.runtime.sendMessage(
            {
              type: 'memory_clear'
            },
            (response) => {
              if (chromeAPI.runtime.lastError) {
                reject(new Error(chromeAPI.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve();
              }
            }
          );
        });
      },

      async keys(): Promise<string[]> {
        return new Promise((resolve, reject) => {
          chromeAPI.runtime.sendMessage(
            {
              type: 'memory_keys'
            },
            (response) => {
              if (chromeAPI.runtime.lastError) {
                reject(new Error(chromeAPI.runtime.lastError.message));
              } else if (response?.error) {
                reject(new Error(response.error));
              } else {
                resolve(response?.keys || []);
              }
            }
          );
        });
      },
    };
  }

  const cleanup = () => {
    // ... existing cleanup ...
    delete (window as any).memory;
  };

  // ... rest of wrapper function ...
}
```

### 3. Sandboxed Iframe Implementation (REPL + Artifacts)

**File**: `packages/web-ui/src/components/SandboxedIframe.ts`

#### Message Protocol for Iframes

```typescript
// Messages sent from iframe via window.parent.postMessage()
{ type: 'memory_set', sandboxId: string, requestId: string, key: string, value: string }
{ type: 'memory_get', sandboxId: string, requestId: string, key: string }
{ type: 'memory_has', sandboxId: string, requestId: string, key: string }
{ type: 'memory_delete', sandboxId: string, requestId: string, key: string }
{ type: 'memory_clear', sandboxId: string, requestId: string }
{ type: 'memory_keys', sandboxId: string, requestId: string }

// Responses sent back via iframe.contentWindow.postMessage()
{ type: 'memory_response', sandboxId: string, requestId: string, success: boolean, value?: string, exists?: boolean, keys?: string[], error?: string }
```

#### Memory API Injection in Runtime

Update `getRuntimeScript()` in `SandboxedIframe.ts` to add memory API after existing helper functions:

```typescript
private getRuntimeScript(sandboxId: string, attachments: Attachment[]): string {
  // ... existing attachments data conversion ...

  const runtimeFunc = () => {
    // ... existing helper functions (listFiles, readTextFile, readBinaryFile, returnFile) ...

    // Memory API for sandboxed iframe
    let memoryRequestId = 0;

    (window as any).memory = {
      async set(key: string, value: any): Promise<void> {
        const stringified = JSON.stringify(value);
        const reqId = `${sandboxId}_${memoryRequestId++}`;

        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
              window.removeEventListener('message', handler);
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve();
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'memory_set',
            sandboxId,
            requestId: reqId,
            key,
            value: stringified
          }, '*');
        });
      },

      async get(key: string): Promise<any> {
        const reqId = `${sandboxId}_${memoryRequestId++}`;

        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
              window.removeEventListener('message', handler);
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve(e.data.value ? JSON.parse(e.data.value) : undefined);
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'memory_get',
            sandboxId,
            requestId: reqId,
            key
          }, '*');
        });
      },

      async has(key: string): Promise<boolean> {
        const reqId = `${sandboxId}_${memoryRequestId++}`;

        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
              window.removeEventListener('message', handler);
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve(e.data.exists || false);
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'memory_has',
            sandboxId,
            requestId: reqId,
            key
          }, '*');
        });
      },

      async delete(key: string): Promise<void> {
        const reqId = `${sandboxId}_${memoryRequestId++}`;

        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
              window.removeEventListener('message', handler);
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve();
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'memory_delete',
            sandboxId,
            requestId: reqId,
            key
          }, '*');
        });
      },

      async clear(): Promise<void> {
        const reqId = `${sandboxId}_${memoryRequestId++}`;

        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
              window.removeEventListener('message', handler);
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve();
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'memory_clear',
            sandboxId,
            requestId: reqId
          }, '*');
        });
      },

      async keys(): Promise<string[]> {
        const reqId = `${sandboxId}_${memoryRequestId++}`;

        return new Promise((resolve, reject) => {
          const handler = (e: MessageEvent) => {
            if (e.data.type === 'memory_response' && e.data.requestId === reqId) {
              window.removeEventListener('message', handler);
              if (e.data.error) {
                reject(new Error(e.data.error));
              } else {
                resolve(e.data.keys || []);
              }
            }
          };

          window.addEventListener('message', handler);
          window.parent.postMessage({
            type: 'memory_keys',
            sandboxId,
            requestId: reqId
          }, '*');
        });
      },
    };

    // ... rest of runtime function (console capture, error handlers, complete()) ...
  };

  return (
    `<script>\n` +
    `window.sandboxId = ${JSON.stringify(sandboxId)};\n` +
    `window.attachments = ${JSON.stringify(attachmentsData)};\n` +
    `(${runtimeFunc.toString()})();\n` +
    `</script>`
  );
}
```

#### Message Handler in SandboxedIframe

Add new method to `SandboxedIframe` class:

```typescript
private setupMemoryMessageHandler(): void {
  window.addEventListener('message', async (e: MessageEvent) => {
    // Only handle memory messages from our iframes
    if (!e.data.type?.startsWith('memory_')) return;
    if (!e.source) return;

    const { sandboxId, requestId, key, value } = e.data;

    try {
      // Get session ID from URL (extension) or agent state (web app)
      const sessionId = this.getSessionId();

      // Get memories store (must be available in app storage)
      const storage = getAppStorage();
      const memories = (storage as any).memories;

      if (!memories) {
        throw new Error('Memories store not available - ensure SitegeistAppStorage is initialized');
      }

      let response: any = {
        type: 'memory_response',
        sandboxId,
        requestId,
        success: true
      };

      switch (e.data.type) {
        case 'memory_set':
          await memories.set(sessionId, key, value);
          break;

        case 'memory_get':
          const val = await memories.get(sessionId, key);
          response.value = val;
          break;

        case 'memory_has':
          const exists = await memories.has(sessionId, key);
          response.exists = exists;
          break;

        case 'memory_delete':
          await memories.delete(sessionId, key);
          break;

        case 'memory_clear':
          await memories.clear(sessionId);
          break;

        case 'memory_keys':
          const keys = await memories.keys(sessionId);
          response.keys = keys;
          break;

        default:
          throw new Error('Unknown memory operation');
      }

      // Send response back to iframe
      (e.source as Window).postMessage(response, '*');

    } catch (error: any) {
      // Send error response
      (e.source as Window).postMessage({
        type: 'memory_response',
        sandboxId,
        requestId,
        success: false,
        error: error.message
      }, '*');
    }
  });
}

private getSessionId(): string {
  // Extension context: get from URL
  // @ts-expect-error - chrome may not be defined in web apps
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (sessionId) return sessionId;
  }

  // Web app context: use a default session ID
  // TODO: This should be properly implemented to use the current agent's session
  // For now, we use a fallback that works for single-session web apps
  return 'default-session';
}

override connectedCallback() {
  super.connectedCallback();
  this.setupMemoryMessageHandler();
}
```

## User-Facing API

All three contexts expose the same 6-method API:

```typescript
// Store any JSON-serializable value
await memory.set(key: string, value: any): Promise<void>

// Retrieve value (returns undefined if not found)
await memory.get(key: string): Promise<any>

// Check if key exists
await memory.has(key: string): Promise<boolean>

// Delete a key
await memory.delete(key: string): Promise<void>

// Clear all memory for this session
await memory.clear(): Promise<void>

// Get all keys for this session
await memory.keys(): Promise<string[]>
```

**Automatic JSON serialization**: Values are automatically stringified/parsed

## Usage Patterns

### Pattern 1: Multi-Page Data Collection (Browser JavaScript)

```javascript
// Tool call 1: Page 1 - Extract and save
const transcripts = await memory.get('transcripts') || [];
transcripts.push({
  title: document.title,
  url: location.href,
  transcript: extractTranscript()
});
await memory.set('transcripts', transcripts);
return 'Saved transcript 1';

// Tool call 2: Navigate (separate call!)
location.href = nextVideoUrl;

// Tool call 3: Page 2 - Load, append, save
const transcripts = await memory.get('transcripts') || [];
transcripts.push({
  title: document.title,
  url: location.href,
  transcript: extractTranscript()
});
await memory.set('transcripts', transcripts);
return 'Saved transcript 2';

// Continue...

// Tool call N: Final page - return all
const allTranscripts = await memory.get('transcripts');
return allTranscripts;
```

### Pattern 2: Progressive Data Processing (JavaScript REPL)

```javascript
// REPL call 1: Load CSV, process first batch
const csv = readTextFile(attachments[0].id);
const rows = Papa.parse(csv).data;
const processed = await memory.get('processed') || [];
processed.push(...processFirstBatch(rows));
await memory.set('processed', processed);
console.log(`Processed ${processed.length} rows so far`);

// REPL call 2: Continue processing
const processed = await memory.get('processed') || [];
processed.push(...processNextBatch(rows));
await memory.set('processed', processed);
console.log(`Processed ${processed.length} rows so far`);

// REPL call 3: Finalize and return
const processed = await memory.get('processed') || [];
await memory.clear(); // Clean up
return processed;
```

### Pattern 3: Stateful HTML Artifacts

```html
<!DOCTYPE html>
<html>
<head>
  <title>Persistent Counter</title>
</head>
<body>
  <h1 id="count">0</h1>
  <button onclick="increment()">Increment</button>

  <script>
    // Load count from memory on startup
    async function init() {
      const count = await memory.get('counter') || 0;
      document.getElementById('count').textContent = count;
    }

    // Increment and save to memory
    async function increment() {
      let count = await memory.get('counter') || 0;
      count++;
      await memory.set('counter', count);
      document.getElementById('count').textContent = count;
    }

    init();
  </script>
</body>
</html>
```

## Tool Description Updates

### Browser JavaScript Tool

Add memory section to the tool description:

```markdown
**Memory - Persist Data Across Navigation:**
When navigating between pages (location.href=, history.back(), etc.), the execution context is destroyed.
Use the `memory` object to persist data across navigations within the same session:

- `await memory.set(key, value)` - Store any value (auto JSON serialized)
- `await memory.get(key)` - Retrieve value (returns undefined if missing)
- `await memory.has(key)`, `await memory.delete(key)`, `await memory.clear()`, `await memory.keys()`

Example - Multi-page data collection:
\```javascript
// Tool call 1: Extract and save data
const items = await memory.get('items') || [];
items.push(extractData());
await memory.set('items', items);
return 'Saved item, ready to navigate';

// Tool call 2: Navigate (separate call!)
location.href = nextPageUrl;

// Tool call 3: After navigation, continue collecting
const items = await memory.get('items') || [];
items.push(extractData());
await memory.set('items', items);
\```

CRITICAL: Navigation MUST be in its own separate tool call with ONLY the navigation command.
Always save to memory BEFORE navigating, load from memory AFTER navigation.
```

### JavaScript REPL Tool

Add memory section to the tool description:

```markdown
**Memory - Persist Data Across Executions:**
The `memory` object allows you to persist data across multiple REPL executions within the same session:

- `await memory.set(key, value)` - Store any value (auto JSON serialized)
- `await memory.get(key)` - Retrieve value (returns undefined if missing)
- `await memory.has(key)`, `await memory.delete(key)`, `await memory.clear()`, `await memory.keys()`

Use cases:
- Progressive data processing across multiple REPL calls
- Maintaining state between iterations
- Building up results incrementally

Example:
\```javascript
// REPL call 1: Start processing
const results = await memory.get('results') || [];
results.push(...processFirstBatch());
await memory.set('results', results);

// REPL call 2: Continue
const results = await memory.get('results') || [];
results.push(...processNextBatch());
await memory.set('results', results);

// REPL call 3: Finalize
const results = await memory.get('results') || [];
await memory.clear(); // Clean up
return results;
\```
```

### HTML Artifacts

HTML artifacts automatically have access to the `memory` API - no changes needed to tool descriptions. The API is available in the global scope just like in REPL.

## Session Lifecycle Integration

Memories are part of a session's lifecycle and are automatically cleaned up when a session is deleted.

**Implementation**: The `SitegeistAppStorage.deleteSession()` override (shown above) automatically calls `memories.clear(sessionId)`.

**Benefits**:
- No manual cleanup needed
- No periodic cleanup jobs
- No expired data accumulation
- Session deletion is atomic (deletes session + memories together)

## Security Considerations

1. **Isolation**: Memory is scoped to session ID, preventing cross-session data leakage
2. **Sandboxing**: REPL/artifacts run in sandboxed iframes with no network access
3. **Message validation**: All postMessage communication validates message types and structure
4. **Size limits**: Consider implementing per-session quotas to prevent abuse (future enhancement)
5. **Sensitive data**: Memory is persistent within session - avoid storing sensitive information

## Implementation Checklist

### Storage Layer (Store Pattern)
- [ ] Implement `MemoriesStore` extending `Store` in `src/storage/stores/memories-store.ts`
  - [ ] Implement `getConfig()` returning store config
  - [ ] Implement all 6 methods (get, set, delete, has, keys, clear)
  - [ ] Use session-prefixed keys (`${sessionId}_${key}`)
- [ ] Update `SitegeistAppStorage` in `src/storage/app-storage.ts`
  - [ ] Add `memories: MemoriesStore` field
  - [ ] Include memories config in stores array
  - [ ] Wire backend to memories store
  - [ ] Override `deleteSession()` to clear memories
- [ ] Add `getSitegeistStorage()` helper function
- [ ] Initialize `SitegeistAppStorage` in `src/sidepanel.ts`

### Browser JavaScript Tool
- [ ] Add `registerMemoryMessageHandler()` function
- [ ] Add `getCurrentSessionId()` helper
- [ ] Inject memory API in `wrapperFunction()`
- [ ] Add cleanup for memory API
- [ ] Update tool description with Memory section
- [ ] Test multi-page navigation with memory persistence

### Sandboxed Iframe (REPL + Artifacts)
- [ ] Add memory API injection in `getRuntimeScript()` in `SandboxedIframe.ts`
- [ ] Implement `setupMemoryMessageHandler()` method
- [ ] Add `getSessionId()` method (handle both extension and web app contexts)
- [ ] Call `setupMemoryMessageHandler()` in `connectedCallback()`
- [ ] Update REPL tool description with Memory section
- [ ] Test REPL with multi-call memory persistence
- [ ] Test HTML artifact with stateful memory

### Testing
- [ ] Test browser_javascript: multi-page scraping with memory
- [ ] Test javascript_repl: progressive data processing with memory
- [ ] Test HTMLArtifact: stateful UI with memory persistence
- [ ] Test session deletion clears memories
- [ ] Test memory isolation between sessions
- [ ] Test large memory values (MB+ range)
- [ ] Test error handling for all memory operations
- [ ] Test concurrent memory operations

## Future Enhancements

1. **TTL (Time To Live)**: Auto-expire memory entries after N hours
2. **Compression**: Compress large values before storage
3. **Transactions**: Atomic multi-key operations
4. **Export/Import**: Allow user to save/restore memory state
5. **Debugging UI**: Panel to inspect current session memory
6. **Quotas**: Per-session size limits with warnings
7. **Web App Session Management**: Proper session ID handling in web apps (currently uses fallback)

## FAQ

**Q: Why not just use localStorage?**
A: localStorage pollutes the website's storage, persists beyond the session, and doesn't work in sandboxed iframes.

**Q: Can I use memory in web apps (non-extension)?**
A: Yes! The REPL and HTML artifacts work in web apps. Only browser_javascript requires an extension.

**Q: What's the size limit?**
A: IndexedDB typically allows 10GB+ in modern browsers, far more than chrome.storage.local's 10MB limit.

**Q: Is memory shared between sessions?**
A: No, each session (conversation) has isolated memory namespace via session ID.

**Q: What happens if I store binary data?**
A: Values must be JSON-serializable. For binary data, encode as base64 string first.

**Q: Can I use memory in nested iframes?**
A: No, the memory API only works at the top level of each execution context (user script or direct sandbox iframe).

**Q: Does memory work in the browser_javascript tool when the page has a strict CSP?**
A: Yes, the memory API uses `chrome.runtime.sendMessage()` which bypasses page CSP restrictions.

**Q: How does the sandboxed iframe get access to the MemoriesStore?**
A: The parent window (which hosts the `SandboxedIframe` component) has access to `AppStorage` via `getAppStorage()`, which includes the memories store in Sitegeist.
