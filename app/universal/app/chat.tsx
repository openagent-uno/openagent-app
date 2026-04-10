/**
 * Chat screen — ChatGPT-style interface with multi-session support.
 */

import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';

export default function ChatScreen() {
  const ws = useConnection((s) => s.ws);
  const agentName = useConnection((s) => s.agentName);
  const {
    sessions, activeSessionId, createSession, setActiveSession, removeSession,
    addUserMessage,
  } = useChat();

  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Auto-scroll on new messages
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [activeSession?.messages.length, activeSession?.statusText]);

  const handleSend = () => {
    if (!input.trim() || !ws || !activeSessionId) return;
    addUserMessage(activeSessionId, input.trim());
    ws.sendMessage(input.trim(), activeSessionId);
    setInput('');
  };

  return (
    <View style={styles.container}>
      {/* Sidebar */}
      <View style={styles.sidebar}>
        <Text style={styles.sidebarTitle}>{agentName || 'OpenAgent'}</Text>

        <TouchableOpacity style={styles.newChatBtn} onPress={createSession}>
          <Text style={styles.newChatText}>+ New Chat</Text>
        </TouchableOpacity>

        <ScrollView style={styles.sessionList}>
          {sessions.map((ses) => (
            <TouchableOpacity
              key={ses.id}
              style={[
                styles.sessionItem,
                ses.id === activeSessionId && styles.sessionActive,
              ]}
              onPress={() => setActiveSession(ses.id)}
              onLongPress={() => removeSession(ses.id)}
            >
              <Text
                style={styles.sessionTitle}
                numberOfLines={1}
              >
                {ses.title}
              </Text>
              {ses.isProcessing && (
                <Text style={styles.processingDot}>●</Text>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Chat area */}
      <View style={styles.chatArea}>
        {activeSession ? (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.messages}
              contentContainerStyle={styles.messagesContent}
            >
              {activeSession.messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.bubble,
                    msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <Text style={styles.bubbleText}>{msg.text}</Text>
                </View>
              ))}

              {activeSession.isProcessing && (
                <View style={[styles.bubble, styles.statusBubble]}>
                  <Text style={styles.statusText}>
                    ⏳ {activeSession.statusText || 'Thinking...'}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Input bar */}
            <View style={styles.inputBar}>
              <TextInput
                style={styles.textInput}
                value={input}
                onChangeText={setInput}
                placeholder="Type a message..."
                placeholderTextColor="#666"
                onSubmitEditing={handleSend}
                returnKeyType="send"
                multiline
              />
              <TouchableOpacity
                style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!input.trim() || activeSession.isProcessing}
              >
                <Text style={styles.sendText}>↑</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Select a chat or create a new one
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#1a1a2e' },

  // Sidebar
  sidebar: {
    width: 260,
    backgroundColor: '#16213e',
    borderRightWidth: 1,
    borderRightColor: '#0f3460',
    padding: 16,
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e0e0e0',
    marginBottom: 16,
  },
  newChatBtn: {
    backgroundColor: '#533483',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  newChatText: { color: '#e0e0e0', fontWeight: '600' },
  sessionList: { flex: 1 },
  sessionItem: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionActive: { backgroundColor: '#0f3460' },
  sessionTitle: { color: '#ccc', flex: 1, fontSize: 13 },
  processingDot: { color: '#2ecc71', fontSize: 10, marginLeft: 6 },

  // Chat
  chatArea: { flex: 1, flexDirection: 'column' },
  messages: { flex: 1 },
  messagesContent: { padding: 20, paddingBottom: 8 },
  bubble: {
    maxWidth: '75%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  userBubble: {
    backgroundColor: '#533483',
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    backgroundColor: '#16213e',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  statusBubble: {
    backgroundColor: 'transparent',
    alignSelf: 'flex-start',
  },
  bubbleText: { color: '#e0e0e0', fontSize: 14, lineHeight: 20 },
  statusText: { color: '#888', fontSize: 13, fontStyle: 'italic' },

  // Input
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#e0e0e0',
    fontSize: 14,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#533483',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // Empty
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 16 },
});
