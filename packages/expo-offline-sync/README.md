# expo-offline-sync 🚀

[![npm version](https://img.shields.io/npm/v/expo-offline-sync.svg?style=flat-square)](https://www.npmjs.com/package/expo-offline-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![Expo SDK](https://img.shields.io/badge/Expo_SDK-51%20|%2052+-black.svg?style=flat-square)](https://expo.dev/)
[![Platform](https://img.shields.io/badge/Platforms-iOS%20|%20Android%20|%20Web-lightgrey.svg?style=flat-square)](#)

> **Deterministic, scoped, engine-agnostic offline mutation & request queue for Expo & React Native.**  
> Add offline-first resilience to your existing REST, GraphQL, or tRPC endpoints in **under 10 minutes** without rewriting your database.

---

## 🌟 Why expo-offline-sync?

Existing offline solutions force extreme trade-offs:

- **Heavyweight / Invasive (WatermelonDB, RxDB, PowerSync):** Require rewriting your entire schema with custom ORMs, setting up specialized sync backends, or paying for proprietary cloud sync engines.
- **Legacy & Abandoned (redux-offline):** Bound to Redux, broken in modern Expo / React Native New Architecture.
- **TanStack Query Mutation Limitations:** Storing pending mutations across app restarts is notoriously tricky and fails when functions/closures cannot be serialized.

**`expo-offline-sync` takes the pragmatic approach:**  
Keep your existing backend and state management (Zustand, TanStack Query, Redux, or raw fetch). Whenever the user performs an action while offline (e.g. sending a message, submitting a form, liking a post), it safely queues it into **encrypted/durable local SQLite** and synchronizes deterministically when connectivity returns.

---

## ✨ Features

- 🎯 **Engine-Agnostic:** Works with fetch, Axios, TanStack Query, Zustand, tRPC, GraphQL, or Firebase.
- 🛡 **Scoped Queuing (No Head-of-Line Blocking):** Mutations can run in independent scopes (e.g. `scope: 'chat:room_1'`). A retry in Room 1 will **never** block a profile update in another scope.
- 🔁 **Jittered Exponential Backoff:** Smart retry policies prevent server thundering herds.
- 🔐 **Dynamic Auth Token Injection:** Injects fresh JWT/Bearer tokens at execution time (`getHeaders`). Enqueued mutations won't fail with 401 even after being offline for hours!
- 💾 **Durable SQLite Storage:** Backed by modern Expo SQLite (SDK 51/52+ fast asynchronous API) with in-memory fallbacks.
- 🎨 **Optimistic UI & Rollback:** Built-in `useOfflineMutation` hook gives instant UI feedback and clean rollback on permanent failure.
- 🌙 **Background Sync Support:** Optional plugin for `expo-background-fetch` and `expo-task-manager` to sync while the app is in the background or killed.
- 🧩 **100% Customizable:** Custom storage adapters, custom retry rules, custom network checks, and request interceptors.

---

## 📦 Installation

```bash
npx expo install expo-offline-sync expo-sqlite @react-native-community/netinfo
```

_(Optional: For background sync capabilities)_

```bash
npx expo install expo-background-fetch expo-task-manager
```

---

## 🚀 Quick Start (5 Minutes)

### 1. Initialize the Provider

Wrap your app with `OfflineSyncProvider`:

```tsx
// App.tsx
import React from "react";
import { OfflineSyncProvider } from "expo-offline-sync";

export default function App() {
  return (
    <OfflineSyncProvider
      options={{
        // Dynamically resolve auth token before replaying requests
        getHeaders: async () => ({
          Authorization: `Bearer ${await getAuthToken()}`,
        }),
      }}
    >
      <MainScreen />
    </OfflineSyncProvider>
  );
}
```

---

### 2. Register Mutations (Typed Registry Pattern)

Register handlers anywhere during app initialization (e.g. `sync.ts` or inside your API layer):

```typescript
import { OfflineSyncClient } from "expo-offline-sync";

export const syncClient = new OfflineSyncClient();

// Register a mutation handler
syncClient.register(
  "SEND_MESSAGE",
  async (payload: { chatId: string; text: string }) => {
    const response = await fetch(
      `https://api.example.com/chats/${payload.chatId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload.text }),
      },
    );

    if (!response.ok) throw new Error("Failed to send message");
    return response.json();
  },
);
```

---

### 3. Use in React (WhatsApp-Style Chat Example)

```tsx
import React, { useState } from "react";
import { View, Text, TextInput, Button } from "react-native";
import { useOfflineMutation, useQueueStatus } from "expo-offline-sync";

export function ChatScreen({ chatId }: { chatId: string }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<any[]>([]);

  // Hook automatically manages optimistic updates & rollback
  const { mutate } = useOfflineMutation({
    type: "SEND_MESSAGE",
    scope: `chat:${chatId}`, // Scoped FIFO queue for this chat room
    onMutate: (payload, item) => {
      // 1. Instant Optimistic Update
      setMessages((prev) => [
        ...prev,
        { id: item.id, text: payload.text, status: "pending" }, // Shows clock icon 🕒
      ]);
    },
    onSuccess: (result, item) => {
      // 2. Mark as delivered ✓✓
      setMessages((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, status: "sent" } : m)),
      );
    },
    onError: (error, item) => {
      // 3. Mark as failed ⚠️
      setMessages((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, status: "failed" } : m)),
      );
    },
  });

  const handleSend = () => {
    mutate({ chatId, text });
    setText("");
  };

  return (
    <View>
      {messages.map((m) => (
        <Text key={m.id}>
          {m.text} {m.status === "pending" ? "🕒" : "✓✓"}
        </Text>
      ))}
      <TextInput value={text} onChangeText={setText} />
      <Button title="Send" onPress={handleSend} />
    </View>
  );
}
```

---

### 4. Zero-Boilerplate Direct REST Requests (`enqueueHttp`)

Don't want to register a mutation handler? Queue any REST request directly:

```typescript
await syncClient.enqueueHttp({
  url: "https://api.example.com/v1/posts/like",
  method: "POST",
  body: { postId: "123" },
  scope: "likes", // runs sequentially for likes
});
```

---

## 🔌 Integrations & Recipes

### 1. TanStack Query (React Query) Integration
Combine the caching power of TanStack Query with `expo-offline-sync`'s persistent SQLite queue:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOfflineSync } from 'expo-offline-sync';

export function useOfflineCreateTodo() {
  const queryClient = useQueryClient();
  const offlineSync = useOfflineSync();

  return useMutation({
    mutationFn: async (newTodo: { title: string }) => {
      // Enqueues into durable SQLite and executes when online
      return offlineSync.enqueue({
        type: 'CREATE_TODO',
        payload: newTodo,
        scope: 'todos',
      });
    },
    onMutate: async (newTodo) => {
      // Cancel outgoing refetches and update local query cache optimistically
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const previousTodos = queryClient.getQueryData(['todos']);

      queryClient.setQueryData(['todos'], (old: any[] = []) => [
        { id: 'temp-' + Date.now(), ...newTodo, isPending: true },
        ...old,
      ]);

      return { previousTodos };
    },
    onError: (err, newTodo, context) => {
      // Rollback cache if mutation failed
      queryClient.setQueryData(['todos'], context?.previousTodos);
    },
  });
}
```

### 2. Zustand Store Integration
Trigger offline mutations directly inside your Zustand store actions:

```typescript
import { create } from 'zustand';
import { syncClient } from './syncClient';

interface CartState {
  items: string[];
  addToCart: (item: string) => Promise<void>;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  addToCart: async (item) => {
    // 1. Instant local store update
    set((state) => ({ items: [...state.items, item] }));

    // 2. Queue persistent server sync
    await syncClient.enqueue({
      type: 'ADD_TO_CART',
      payload: { item },
      scope: 'cart',
      onRollback: () => {
        // Rollback state if server rejects
        set((state) => ({ items: state.items.filter((i) => i !== item) }));
      },
    });
  },
}));
```

---

## 🎛 Queue Monitoring & Status (`useQueueStatus`)

Track real-time queue counts and trigger manual syncs:

```tsx
import { useQueueStatus } from "expo-offline-sync";

export function QueueHeader() {
  const { isOnline, isSyncing, stats, sync, retryAll } = useQueueStatus();

  return (
    <View>
      <Text>{isOnline ? "🟢 Connected" : "🔴 Offline"}</Text>
      <Text>Pending in SQLite: {stats.pending}</Text>
      <Text>Failed items: {stats.failed}</Text>

      <Button title="Sync Now" onPress={() => sync()} disabled={isSyncing} />
      {stats.failed > 0 && (
        <Button title="Retry Failed" onPress={() => retryAll()} />
      )}
    </View>
  );
}
```

---

## 🌙 Background Sync (Optional)

Replay pending requests even if the user closed the app:

```typescript
import { registerBackgroundSync } from "expo-offline-sync";

// Call in root index.js / App.tsx
await registerBackgroundSync(syncClient, {
  minimumInterval: 15 * 60, // 15 minutes (iOS minimum)
  startOnBoot: true,
});
```

---

## ⚙️ Advanced Customization

Every component of `expo-offline-sync` can be customized:

```typescript
const client = new OfflineSyncClient({
  // 1. Custom Storage Adapter (defaults to SQLiteAdapter)
  storage: new SQLiteAdapter({ databaseName: "my_app_offline.db" }),

  // 2. Custom Retry Policy
  retryPolicy: {
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitter: true,
    shouldRetry: (error, item) => {
      // Don't retry 400 or 422 errors; retry 5xx and network errors
      if (
        error?.status >= 400 &&
        error?.status < 500 &&
        error?.status !== 401
      ) {
        return false;
      }
      return true;
    },
  },

  // 3. Concurrency
  maxConcurrentScopes: 4, // Max different scopes executing in parallel

  // 4. Global Request Lifecycle
  onRequest: async (item) => {
    console.log(`Executing mutation ${item.id} of type ${item.type}`);
  },
  onResponse: async (item, result) => {
    console.log(`Mutation ${item.id} completed successfully`);
  },
  onRollback: async (item, error) => {
    console.warn(`Mutation ${item.id} permanently failed:`, error.message);
  },
});
```

---

## 📊 Comparison

| Feature                          | `expo-offline-sync` |      WatermelonDB      |   TanStack Query   |  redux-offline  |
| :------------------------------- | :-----------------: | :--------------------: | :----------------: | :-------------: |
| **Setup Time**                   |    **< 10 mins**    |      Days / Weeks      |      ~1 hour       |    ~2 hours     |
| **Backend Changes**              |      **Zero**       | Required Sync Protocol |        Zero        |      Zero       |
| **Works with Any State Manager** |         ✅          |      ❌ (Own ORM)      | ❌ (TanStack only) | ❌ (Redux only) |
| **Survives App Restarts**        | ✅ (Durable SQLite) |           ✅           | ⚠️ Flaky Closures  |       ✅        |
| **Scoped FIFO (No Blockings)**   |         ✅          |           ❌           |         ❌         |       ❌        |
| **Dynamic Token Refresh**        |         ✅          |           ❌           |    Custom code     |       ❌        |
| **Expo SDK 51/52+ Ready**        |         ✅          |      Needs config      |         ✅         |    ❌ Broken    |

---

## 📄 License

MIT © [mamicrose](https://github.com/mamicrose/expo-offline-sync/blob/main/LICENSE)
