import React, { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  ManualNetworkMonitor,
  MemoryAdapter,
  OfflineSyncClient,
  OfflineSyncProvider,
  useIsOnline,
  useOfflineMutation,
  useQueueStatus,
} from 'expo-offline-sync';

interface ChatMessage {
  id: string;
  text: string;
  sender: 'me' | 'other';
  status: 'pending' | 'syncing' | 'sent' | 'failed';
  timestamp: string;
}

interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  isOptimistic?: boolean;
}

// Simulated server delay helper
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

function DemoScreen({
  simulateFailure,
  setSimulateFailure,
  networkMonitor,
}: {
  simulateFailure: boolean;
  setSimulateFailure: (val: boolean) => void;
  networkMonitor: ManualNetworkMonitor;
}) {
  const isOnline = useIsOnline();
  const { stats, isSyncing, sync, retryAll, clear } = useQueueStatus();
  const [activeTab, setActiveTab] = useState<'chat' | 'todos'>('chat');

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-0',
      text: 'Welcome to expo-offline-sync! Try turning off the network and sending a message.',
      sender: 'other',
      status: 'sent',
      timestamp: '12:00',
    },
  ]);
  const [inputText, setInputText] = useState('');

  // Todos State
  const [todos, setTodos] = useState<TodoItem[]>([
    { id: '1', title: 'Test offline form submission', completed: false },
    { id: '2', title: 'Verify exponential backoff retry', completed: true },
  ]);
  const [todoInput, setTodoInput] = useState('');

  // Chat Mutation Hook
  const chatMutation = useOfflineMutation<
    { id: string; text: string },
    { serverId: string; deliveredAt: number }
  >({
    type: 'SEND_MESSAGE',
    scope: 'chat:room_1', // Scoped FIFO queue
    onMutate: (payload) => {
      // Optimistic update
      setMessages((prev) => [
        ...prev,
        {
          id: payload.id,
          text: payload.text,
          sender: 'me',
          status: 'pending',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    },
    onSuccess: (result, item) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === item.payload.id ? { ...msg, status: 'sent' } : msg
        )
      );
    },
    onError: (err, item) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === item.payload.id ? { ...msg, status: 'failed' } : msg
        )
      );
    },
  });

  // Todo Mutation Hook
  const todoMutation = useOfflineMutation<{ id: string; title: string }>({
    type: 'CREATE_TODO',
    scope: 'todos',
    onMutate: (payload) => {
      // Optimistic insert
      setTodos((prev) => [
        { id: payload.id, title: payload.title, completed: false, isOptimistic: true },
        ...prev,
      ]);
    },
    onSuccess: (_, item) => {
      setTodos((prev) =>
        prev.map((t) => (t.id === item.payload.id ? { ...t, isOptimistic: false } : t))
      );
    },
    onError: (_, item) => {
      // Rollback optimistic insert
      setTodos((prev) => prev.filter((t) => t.id !== item.payload.id));
    },
  });

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    const msgId = 'temp-' + Date.now();
    chatMutation.mutate({ id: msgId, text: inputText.trim() });
    setInputText('');
  };

  const handleAddTodo = () => {
    if (!todoInput.trim()) return;
    const todoId = 'todo-' + Date.now();
    todoMutation.mutate({ id: todoId, title: todoInput.trim() });
    setTodoInput('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Network & Simulation Controls Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>🚀 expo-offline-sync</Text>
          <View style={[styles.badge, isOnline ? styles.onlineBadge : styles.offlineBadge]}>
            <Text style={styles.badgeText}>{isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}</Text>
          </View>
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchItem}>
            <Text style={styles.switchLabel}>Simulate Connection:</Text>
            <Switch
              value={isOnline}
              onValueChange={(val) => networkMonitor.setOnline(val)}
              trackColor={{ false: '#fca5a5', true: '#86efac' }}
            />
          </View>
          <View style={styles.switchItem}>
            <Text style={styles.switchLabel}>Simulate 500 Error:</Text>
            <Switch
              value={simulateFailure}
              onValueChange={setSimulateFailure}
              trackColor={{ false: '#e2e8f0', true: '#fca5a5' }}
            />
          </View>
        </View>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'chat' && styles.activeTab]}
          onPress={() => setActiveTab('chat')}
        >
          <Text style={[styles.tabText, activeTab === 'chat' && styles.activeTabText]}>
            💬 Offline Chat
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'todos' && styles.activeTab]}
          onPress={() => setActiveTab('todos')}
        >
          <Text style={[styles.tabText, activeTab === 'todos' && styles.activeTabText]}>
            📝 Optimistic Todos
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {activeTab === 'chat' ? (
          <View style={styles.chatContainer}>
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageList}
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageBubble,
                    item.sender === 'me' ? styles.myMessage : styles.otherMessage,
                  ]}
                >
                  <Text style={styles.messageText}>{item.text}</Text>
                  <View style={styles.messageFooter}>
                    <Text style={styles.timestamp}>{item.timestamp}</Text>
                    {item.sender === 'me' && (
                      <Text style={styles.statusIndicator}>
                        {item.status === 'sent' && ' ✓✓'}
                        {item.status === 'pending' && ' 🕒 (Queued)'}
                        {item.status === 'syncing' && ' 🔄 (Sending...)'}
                        {item.status === 'failed' && ' ⚠️ (Failed)'}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            />

            <View style={styles.inputBar}>
              <TextInput
                style={styles.input}
                placeholder="Type a message (works offline)..."
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={handleSendMessage}
              />
              <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.todoContainer}>
            <View style={styles.inputBar}>
              <TextInput
                style={styles.input}
                placeholder="Add new task..."
                value={todoInput}
                onChangeText={setTodoInput}
                onSubmitEditing={handleAddTodo}
              />
              <TouchableOpacity style={styles.sendButton} onPress={handleAddTodo}>
                <Text style={styles.sendButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.todoList}>
              {todos.map((todo) => (
                <View key={todo.id} style={styles.todoCard}>
                  <Text style={[styles.todoText, todo.completed && styles.todoDone]}>
                    {todo.title}
                  </Text>
                  {todo.isOptimistic && (
                    <Text style={styles.optimisticTag}>Optimistic (Queued)</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Queue Inspector Drawer / Footer */}
      <View style={styles.queueFooter}>
        <View style={styles.statsRow}>
          <Text style={styles.statsTitle}>
            Queue Status {isSyncing ? '🔄 Syncing...' : '💤 Idle'}
          </Text>
          <View style={styles.statsChips}>
            <Text style={styles.chip}>Pending: {stats.pending}</Text>
            <Text style={styles.chip}>Failed: {stats.failed}</Text>
            <Text style={styles.chip}>Total: {stats.total}</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => sync()}>
            <Text style={styles.actionBtnText}>⚡ Sync Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => retryAll()}>
            <Text style={styles.actionBtnText}>🔄 Retry Failed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.clearBtn]}
            onPress={() => clear()}
          >
            <Text style={styles.actionBtnText}>🗑 Clear</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [simulateFailure, setSimulateFailure] = useState(false);
  const networkMonitor = useMemo(() => new ManualNetworkMonitor(true), []);
  const storage = useMemo(() => new MemoryAdapter(), []);

  const client = useMemo(() => {
    const c = new OfflineSyncClient({
      storage,
      networkMonitor,
      autoSync: true,
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 1500,
        backoffFactor: 2,
        jitter: true,
      },
    });

    // 1. Register Chat Handler
    c.register('SEND_MESSAGE', async (payload: { id: string; text: string }) => {
      await delay(800); // Simulate network latency
      if (simulateFailure) {
        const error: any = new Error('Simulated 500 Server Error');
        error.status = 500;
        throw error;
      }
      return { serverId: 'srv-' + Date.now(), deliveredAt: Date.now() };
    });

    // 2. Register Todo Handler
    c.register('CREATE_TODO', async (payload: { id: string; title: string }) => {
      await delay(600);
      if (simulateFailure) {
        const error: any = new Error('Simulated 500 Server Error');
        error.status = 500;
        throw error;
      }
      return { success: true };
    });

    return c;
  }, [networkMonitor, storage, simulateFailure]);

  return (
    <OfflineSyncProvider client={client}>
      <DemoScreen
        simulateFailure={simulateFailure}
        setSimulateFailure={setSimulateFailure}
        networkMonitor={networkMonitor}
      />
    </OfflineSyncProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  onlineBadge: {
    backgroundColor: '#dcfce7',
  },
  offlineBadge: {
    backgroundColor: '#fee2e2',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  switchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  activeTabText: {
    color: '#2563eb',
  },
  content: {
    flex: 1,
  },
  chatContainer: {
    flex: 1,
  },
  messageList: {
    padding: 16,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#dbeafe',
    borderBottomRightRadius: 4,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  messageText: {
    fontSize: 15,
    color: '#1e293b',
    lineHeight: 20,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  timestamp: {
    fontSize: 11,
    color: '#64748b',
  },
  statusIndicator: {
    fontSize: 11,
    color: '#3b82f6',
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#f1f5f9',
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#0f172a',
  },
  sendButton: {
    height: 44,
    paddingHorizontal: 18,
    backgroundColor: '#2563eb',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  todoContainer: {
    flex: 1,
  },
  todoList: {
    padding: 16,
    gap: 10,
  },
  todoCard: {
    padding: 14,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  todoText: {
    fontSize: 15,
    color: '#0f172a',
  },
  todoDone: {
    textDecorationLine: 'line-through',
    color: '#94a3b8',
  },
  optimisticTag: {
    fontSize: 11,
    color: '#d97706',
    fontWeight: '600',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  queueFooter: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    padding: 14,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  statsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  statsChips: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    fontSize: 11,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    color: '#475569',
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    alignItems: 'center',
  },
  clearBtn: {
    backgroundColor: '#ef4444',
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});

