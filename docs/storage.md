# Storage Architecture

## Status

⚠️ **IMPLEMENTATION PLAN - NOT EXECUTED**

This document describes a comprehensive plan to unify storage architecture. Current implementation uses fragmented storage backends.

## Current Implementation

**chrome.storage.local** (via `WebExtensionStorageBackend`)
- Skills, settings, provider keys
- 10MB quota limit
- Location: [src/storage/app-storage.ts](../src/storage/app-storage.ts)

**IndexedDB Sessions** (`SessionIndexedDBBackend`)
- Database: `pi-extension-sessions`
- Session data and metadata
- Location: [pi-mono/packages/web-ui/src/storage/backends/session-indexeddb-backend.ts](../../pi-mono/packages/web-ui/src/storage/backends/session-indexeddb-backend.ts)

**Problems**:
- 10MB chrome.storage.local limit insufficient for skills with library code
- Multiple storage APIs (chrome.storage vs IndexedDB) create complexity
- No unified quota tracking
- Difficult to extend with new features

## Proposed Solution

Single IndexedDB database `sitegeist-storage` with multiple object stores:

**Core stores** (web-ui):
- `sessions-metadata` - Session listing and metadata
- `sessions-data` - Full session content
- `settings` - Application settings
- `provider-keys` - API keys for LLM providers

**Extension stores** (sitegeist):
- `memories` - Session-scoped key-value pairs
- `skills` - Skill definitions with library code
- `user-prompts` - User prompt templates

**Benefits**:
- **Quota**: 10GB+ vs 10MB (60% disk on Chrome, 50% on Firefox, 1GB+ on Safari)
- **Consistency**: Single API, unified transactions
- **Performance**: Optimized for structured data, efficient queries
- **Atomic operations**: Multi-store transactions
- **Extensibility**: Add stores without creating databases

## Architecture

### StorageBackend Interface

```typescript
// packages/web-ui/src/storage/types.ts

export interface StorageBackend {
  // Basic operations
  get<T>(storeName: string, key: string): Promise<T | null>;
  set<T>(storeName: string, key: string, value: T): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
  keys(storeName: string, prefix?: string): Promise<string[]>;
  clear(storeName: string): Promise<void>;
  has(storeName: string, key: string): Promise<boolean>;

  // Atomic transactions across stores
  transaction<T>(
    storeNames: string[],
    mode: 'readonly' | 'readwrite',
    operation: (tx: StorageTransaction) => Promise<T>
  ): Promise<T>;

  // Quota management
  getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }>;
  requestPersistence(): Promise<boolean>;
}

export interface StorageTransaction {
  get<T>(storeName: string, key: string): Promise<T | null>;
  set<T>(storeName: string, key: string, value: T): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
}
```

### IndexedDB Backend

```typescript
export interface IndexedDBConfig {
  dbName: string;
  version: number;
  stores: StoreConfig[];
}

export interface StoreConfig {
  name: string;
  keyPath?: string;
  indices?: { name: string; keyPath: string }[];
}

export class IndexedDBStorageBackend implements StorageBackend {
  constructor(private config: IndexedDBConfig) {}

  // Lazy database initialization with onupgradeneeded
  // Implements get, set, delete, keys, transaction, quota methods
}
```

### Store Pattern

Each store extends base class, provides config, and implements domain-specific methods:

```typescript
export abstract class Store {
  private backend: StorageBackend | null = null;

  abstract getConfig(): StoreConfig;
  setBackend(backend: StorageBackend): void { /* ... */ }
  protected getBackend(): StorageBackend { /* ... */ }
}
```

**Example stores**:

```typescript
// SettingsStore - Key-value settings
export class SettingsStore extends Store {
  getConfig() { return { name: 'settings' }; }
  async get<T>(key: string): Promise<T | null> { /* ... */ }
  async set<T>(key: string, value: T): Promise<void> { /* ... */ }
}

// SessionsStore - Multi-store transactions
export class SessionsStore extends Store {
  getConfig() {
    return {
      name: 'sessions',
      keyPath: 'id',
      indices: [{ name: 'lastModified', keyPath: 'lastModified' }]
    };
  }

  async save(data: SessionData, metadata: SessionMetadata): Promise<void> {
    await this.getBackend().transaction(['sessions', 'sessions-metadata'], 'readwrite', async (tx) => {
      await tx.set('sessions', data.id, data);
      await tx.set('sessions-metadata', metadata.id, metadata);
    });
  }
}

// MemoriesStore - Session-scoped keys
export class MemoriesStore extends Store {
  getConfig() { return { name: 'memories' }; }

  private makeKey(sessionId: string, key: string) {
    return `${sessionId}_${key}`;
  }

  async get(sessionId: string, key: string): Promise<unknown | null> {
    return this.getBackend().get('memories', this.makeKey(sessionId, key));
  }
}
```

### AppStorage Wiring

```typescript
// Base (web-ui)
export class AppStorage {
  readonly backend: StorageBackend;
  readonly settings: SettingsStore;
  readonly providerKeys: ProviderKeysStore;
  readonly sessions: SessionsStore;

  constructor(settings: SettingsStore, providerKeys: ProviderKeysStore, sessions: SessionsStore) {
    // Stores already have backend wired by subclass
  }
}

// Extended (sitegeist)
export class SitegeistAppStorage extends AppStorage {
  readonly memories: MemoriesStore;
  readonly skills: SkillsStore;
  readonly prompts: PromptsStore;

  constructor() {
    // 1. Create stores
    // 2. Gather configs
    // 3. Create backend with all configs
    // 4. Wire backend to all stores
    // 5. Call super with base stores
  }
}
```

**Benefits**:
- Each store owns its schema (no central config)
- No circular dependencies
- Type-safe domain-specific methods
- Extensible via subclassing
- Testable with mocked backend

## Implementation Details

### Object Store Keys

- `sessions-metadata`: `sessionId` → `{ id, title, createdAt, lastModified, model }`
- `sessions-data`: `sessionId` → `{ id, messages, artifacts }`
- `memories`: `${sessionId}_${key}` → JSON value
- `skills`: `skillName` → `{ name, domainPatterns, description, library, ... }`
- `settings`: `settingKey` → setting value
- `provider-keys`: `providerName` → API key string
- `user-prompts`: `promptId` → `{ id, name, prompt, tags, ... }`

### Prefix Queries (Memories)

Use `IDBKeyRange.bound()` for efficient session-scoped queries:

```typescript
const prefix = `${sessionId}_`;
const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
const keys = await store.getAllKeys(range);
```

### Quota Management

```typescript
async getQuotaInfo() {
  const estimate = await navigator.storage.estimate();
  return {
    usage: estimate.usage || 0,
    quota: estimate.quota || 0,
    percent: (estimate.usage / estimate.quota) * 100
  };
}

async requestPersistence() {
  return await navigator.storage.persist();
}
```

## Migration Plan

**Phase 1**: Implement unified backend in web-ui
- Create `IndexedDBStorageBackend` with store pattern
- Add configuration-based object store creation
- Maintain backward compatibility

**Phase 2**: Extend in sitegeist
- Create `SitegeistAppStorage` extending base
- Add stores: `memories`, `skills`, `user-prompts`

**Phase 3**: Migrate data
- Read from chrome.storage.local and `pi-extension-sessions`
- Write to unified `sitegeist-storage`
- Verify integrity, keep old storage as backup

**Phase 4**: Clean up
- Remove `WebExtensionStorageBackend`
- Delete old database and chrome.storage.local data

## Future Extensions

**User Prompts Store**:
```typescript
{ name: "user-prompts", keyPath: "id", indices: [{ name: "lastUsed", keyPath: "lastUsed" }] }
```

**Workspaces** (multi-project support):
```typescript
{ name: "workspaces", keyPath: "id" }
```

**Export/Import**:
```typescript
async exportAll() {
  for (const storeName of this.config.stores.map(s => s.name)) {
    data[storeName] = await store.getAll();
  }
}
```

**Remote Backend**:
```typescript
export class RemoteStorageBackend implements StorageBackend {
  async get(storeName: string, key: string) {
    return fetch(`${apiUrl}/${storeName}/${key}`).then(r => r.json());
  }
}
```

## Related Files

- [docs/memories.md](memories.md) - Memory persistence API (blocked by this)
- [pi-mono/packages/web-ui/src/storage/backends/session-indexeddb-backend.ts](../../pi-mono/packages/web-ui/src/storage/backends/session-indexeddb-backend.ts)
- [src/storage/app-storage.ts](../src/storage/app-storage.ts)
