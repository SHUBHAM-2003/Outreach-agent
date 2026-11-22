import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  ChevronDown,
  ChevronRight,
  Plus,
  MessageSquare,
  MessagesSquare,
  Trash2,
  Clock,
} from 'lucide-react';
import type { ChatSessionRecord, PendingAction } from '../../modules/outreach/types.ts';
import { apiFetch, notifyUnauthorized } from '../lib/api.ts';
import { ApprovalCard } from './ApprovalCard.tsx';

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  statusText?: string;
  tools?: ToolTrace[];
  pendingActions?: PendingAction[];
  modelUsed?: string;
  error?: string;
}

interface ChatPanelProps {
  chatId: string;
  messages: ChatMessageItem[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessageItem[]>>;
  onNewChat: () => void;
  onSelectChat: (id: string, messages: ChatMessageItem[]) => void;
  draftPrompt?: string;
  onClearDraftPrompt?: () => void;
  onApproveAction: (id: string) => Promise<void>;
  onRejectAction: (id: string) => Promise<void>;
  onRefreshDashboard: () => Promise<void>;
  pendingMap: Record<string, PendingAction>;
}

const STARTER_PROMPTS = [
  'Send an email to maya@northstar.io: Subject "Quick audit idea" Body "Hi Maya, I noticed two quick wins on Northstar Labs..."',
  'Import these leads: Maya Rao, maya@northstar.io, Northstar Labs, https://northstar.io',
  'Send follow-ups to everyone in my active campaign who has not replied yet.',
  'Check inbox for replies and summarize any interested leads.',
];

function formatRelativeAge(iso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  chatId,
  messages,
  setMessages,
  onNewChat,
  onSelectChat,
  draftPrompt,
  onClearDraftPrompt,
  onApproveAction,
  onRejectAction,
  onRefreshDashboard,
  pendingMap,
}) => {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [pastChatsOpen, setPastChatsOpen] = useState(false);
  const [savedChats, setSavedChats] = useState<ChatSessionRecord[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadPastChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const data = await apiFetch<{ chats: ChatSessionRecord[] }>('/api/chats');
      setSavedChats(data.chats ?? []);
    } catch {
      // Ignore transient errors when fetching optional past chats
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    void loadPastChats();
  }, [loadPastChats]);

  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      onClearDraftPrompt?.();
    }
  }, [draftPrompt, onClearDraftPrompt]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  async function persistChatSession(sessionId: string, finalMessages: ChatMessageItem[]) {
    if (finalMessages.length === 0) return;
    const firstUser = finalMessages.find((m) => m.role === 'user')?.content ?? 'New Chat';
    const title = firstUser.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New Chat';
    const sanitized = finalMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      ...(m.tools && m.tools.length > 0 ? { tools: m.tools } : {}),
      ...(m.modelUsed ? { modelUsed: m.modelUsed } : {}),
      ...(m.error ? { error: m.error } : {}),
    }));
    try {
      await apiFetch(`/api/chats/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ title, messages: sanitized }),
      });
      await loadPastChats();
    } catch {
      // Non-fatal if persistence fails
    }
  }

  async function handleDeleteSavedChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await apiFetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSavedChats((prev) => prev.filter((c) => c.id !== id));
      if (id === chatId) {
        onNewChat();
      }
    } catch {
      // Ignore delete error
    }
  }

  async function handleClearAllChats() {
    try {
      await apiFetch('/api/chats', { method: 'DELETE' });
      setSavedChats([]);
      onNewChat();
      setPastChatsOpen(false);
    } catch {
      // Ignore
    }
  }

  function handleSelectSavedChat(c: ChatSessionRecord) {
    if (streaming) return;
    onSelectChat(
      c.id,
      c.messages.map((m) => ({
        ...m,
        pendingActions: [],
      }))
    );
    setPastChatsOpen(false);
  }

  async function sendMessage(textToSend?: string) {
    const content = (textToSend ?? input).trim();
    if (!content || streaming) return;

    setPastChatsOpen(false);
    const activeChatId = chatId;
    const userMsg: ChatMessageItem = {
      id: `u_${Date.now()}`,
      role: 'user',
      content,
    };
    const assistantId = `a_${Date.now()}`;
    let assistantSnapshot: ChatMessageItem = {
      id: assistantId,
      role: 'assistant',
      content: '',
      tools: [],
      pendingActions: [],
    };

    const nextHistory = [...messages, userMsg];
    setMessages([...nextHistory, assistantSnapshot]);
    if (!textToSend) setInput('');
    setStreaming(true);

    const applyAssistantUpdate = (
      transform: (current: ChatMessageItem) => ChatMessageItem
    ) => {
      assistantSnapshot = transform(assistantSnapshot);
      const snapshotCopy = assistantSnapshot;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? snapshotCopy : m)));
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({
          chatId: activeChatId,
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok || !response.body) {
        if (response.status === 401) {
          notifyUnauthorized();
        }
        const errJson = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Chat request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const chunk of lines) {
          const dataLine = chunk
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!dataLine) continue;

          try {
            const evt = JSON.parse(dataLine.slice(6)) as {
              type: string;
              text?: string;
              name?: string;
              args?: Record<string, unknown>;
              result?: unknown;
              action?: PendingAction;
              model?: string;
              message?: string;
            };

            applyAssistantUpdate((m) => {
              if (evt.type === 'status' && evt.text) {
                return { ...m, statusText: evt.text };
              }
              if (evt.type === 'text_delta' && evt.text) {
                return { ...m, content: m.content + evt.text, statusText: undefined };
              }
              if (evt.type === 'model_used' && evt.model) {
                return { ...m, modelUsed: evt.model };
              }
              if (evt.type === 'tool_call' && evt.name) {
                const tools = [...(m.tools ?? []), { name: evt.name, args: evt.args ?? {} }];
                return { ...m, tools };
              }
              if (evt.type === 'tool_result' && evt.name) {
                const tools = [...(m.tools ?? [])];
                for (let i = tools.length - 1; i >= 0; i--) {
                  if (tools[i].name === evt.name && tools[i].result === undefined) {
                    tools[i] = { ...tools[i], result: evt.result };
                    break;
                  }
                }
                return { ...m, tools };
              }
              if (evt.type === 'pending_action' && evt.action) {
                const existing = m.pendingActions ?? [];
                if (existing.some((a) => a.id === evt.action!.id)) return m;
                return { ...m, pendingActions: [...existing, evt.action!] };
              }
              if (evt.type === 'error') {
                return {
                  ...m,
                  error: evt.message || 'Agent execution failed.',
                  statusText: undefined,
                };
              }
              if (evt.type === 'done') {
                return { ...m, statusText: undefined };
              }
              return m;
            });
          } catch {
            // Ignore malformed SSE chunks
          }
        }
      }

      const finalMessages = [...nextHistory, assistantSnapshot];
      await Promise.all([persistChatSession(activeChatId, finalMessages), onRefreshDashboard()]);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Unable to reach agent.';
      const friendly =
        raw.includes('{') && raw.includes('}')
          ? 'The AI service is temporarily unavailable. Please try again in a few moments.'
          : raw;
      applyAssistantUpdate((m) => ({ ...m, error: friendly, statusText: undefined }));
      const finalMessages = [...nextHistory, assistantSnapshot];
      await persistChatSession(activeChatId, finalMessages);
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const activeSavedChat = savedChats.find((c) => c.id === chatId);

  const renderPastChatsList = () => (
    <div className="space-y-1.5 min-w-0">
      {loadingChats && savedChats.length === 0 ? (
        <div className="text-xs text-slate-500 py-2">Loading past chats...</div>
      ) : savedChats.length === 0 ? (
        <div className="text-xs text-slate-500 py-2 break-words">
          No saved chats in the last 24 hours yet.
        </div>
      ) : (
        savedChats.map((c) => {
          const isCurrent = c.id === chatId && messages.length > 0;
          return (
            <div
              key={c.id}
              onClick={() => handleSelectSavedChat(c)}
              className={`p-2.5 rounded-md border flex items-center justify-between gap-2 cursor-pointer transition-colors min-w-0 ${
                isCurrent
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white hover:border-slate-300 border-slate-200 text-slate-900'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs font-medium truncate ${
                    isCurrent ? 'text-white' : 'text-slate-900'
                  }`}
                >
                  {c.title}
                </div>
                <div
                  className={`text-[11px] font-mono truncate ${
                    isCurrent ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {c.messages.length} msg{c.messages.length === 1 ? '' : 's'} ·{' '}
                  {formatRelativeAge(c.updated_at)}
                </div>
              </div>
              <button
                type="button"
                aria-label="Delete chat"
                onClick={(e) => void handleDeleteSavedChat(c.id, e)}
                className={`p-1.5 rounded cursor-pointer shrink-0 ${
                  isCurrent
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-400 hover:text-red-700'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full overflow-hidden">
      {/* Desktop Past Chats Sidebar (24h saved chats, shared global memory) */}
      <aside className="hidden lg:flex lg:w-64 shrink-0 border-r border-slate-200 bg-slate-50/70 flex-col min-h-0">
        <div className="p-3 border-b border-slate-200 space-y-2.5">
          <button
            type="button"
            disabled={streaming}
            onClick={() => {
              setPastChatsOpen(false);
              onNewChat();
            }}
            className="w-full min-h-[36px] px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>New Chat</span>
          </button>

          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Past Chats ({savedChats.length})
            </span>
            {savedChats.length > 0 && (
              <button
                type="button"
                onClick={() => void handleClearAllChats()}
                className="text-[11px] font-medium text-red-700 hover:underline cursor-pointer shrink-0"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 min-h-0">{renderPastChatsList()}</div>

        <div className="p-3 border-t border-slate-200 text-[11px] text-slate-500 space-y-0.5">
          <div className="flex items-center gap-1.5 font-medium text-slate-700">
            <Clock className="w-3 h-3 shrink-0" />
            <span>24h Past Chats</span>
          </div>
          <p className="leading-snug">
            All chats share the single persistent Memory & expire after 24 hours.
          </p>
        </div>
      </aside>

      {/* Main Active Chat Pane */}
      <div className="flex-1 flex flex-col h-full min-h-0 min-w-0 max-w-full overflow-hidden">
        {/* Compact Chat Controls Bar */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <MessageSquare className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 truncate min-w-0">
              {messages.length === 0 ? 'New Chat' : activeSavedChat?.title || 'Current Chat'}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500 whitespace-nowrap shrink-0">
              · Shared memory · 24h chat save
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setPastChatsOpen((prev) => !prev);
                void loadPastChats();
              }}
              className={`lg:hidden min-h-[36px] px-3 border rounded-md text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                pastChatsOpen
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              <MessagesSquare className="w-3.5 h-3.5 shrink-0" />
              <span>Past Chats ({savedChats.length})</span>
            </button>

            <button
              type="button"
              disabled={streaming}
              onClick={() => {
                setPastChatsOpen(false);
                onNewChat();
              }}
              className="lg:hidden min-h-[36px] px-3 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>New Chat</span>
            </button>
          </div>
        </div>

        {/* Mobile / Tablet Past Chats Drawer */}
        {pastChatsOpen && (
          <div className="lg:hidden shrink-0 border-b border-slate-200 bg-slate-50 px-4 sm:px-6 py-3 max-h-64 overflow-y-auto">
            <div className="max-w-3xl mx-auto space-y-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  Past Chats from last 24h (shared single memory)
                </span>
                {savedChats.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleClearAllChats()}
                    className="text-[11px] font-medium text-red-700 hover:underline cursor-pointer shrink-0"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {renderPastChatsList()}
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div
          ref={scrollRef}
          className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4 sm:py-6 space-y-5"
        >
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto pt-2 sm:pt-6 space-y-5 min-w-0">
              <div className="space-y-2 min-w-0">
                <h2 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">
                  Outreach Agent Chat
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed break-words">
                  Start a new chat anytime. Every chat you start is saved under Past Chats for 24
                  hours, while all progress stays in your single workspace Memory.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2 min-w-0">
                <p className="text-xs font-medium text-slate-500">Quick prompts</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="min-w-0 text-left p-3.5 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-md text-xs text-slate-700 leading-relaxed break-words [overflow-wrap:anywhere] transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 min-w-0">
              {messages.map((msg) => {
                const toolsExpanded = Boolean(expandedTools[msg.id]);
                return (
                  <div
                    key={msg.id}
                    className={
                      msg.role === 'user'
                        ? 'flex justify-end min-w-0'
                        : 'flex justify-start min-w-0'
                    }
                  >
                    <div
                      className={
                        msg.role === 'user'
                          ? 'max-w-[90%] sm:max-w-xl min-w-0 bg-slate-900 text-white rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
                          : 'w-full min-w-0 space-y-3 overflow-hidden'
                      }
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex items-center justify-between gap-3 text-xs text-slate-500 min-w-0">
                          <span className="font-medium text-slate-700 shrink-0">Outreach Agent</span>
                          {msg.modelUsed && (
                            <span className="font-mono text-slate-400 truncate min-w-0">
                              {msg.modelUsed}
                            </span>
                          )}
                        </div>
                      )}

                      {msg.role === 'assistant' && msg.tools && msg.tools.length > 0 && (
                        <div className="border border-slate-200 bg-white rounded-md min-w-0 overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTools((prev) => ({
                                ...prev,
                                [msg.id]: !toolsExpanded,
                              }))
                            }
                            className="w-full min-w-0 px-3 py-2 flex items-center justify-between gap-2 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            <span className="font-mono truncate min-w-0 text-left">
                              {msg.tools.length} tool call{msg.tools.length === 1 ? '' : 's'} (
                              {msg.tools.map((t) => t.name).join(', ')})
                            </span>
                            {toolsExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                            )}
                          </button>
                          {toolsExpanded && (
                            <div className="border-t border-slate-200 divide-y divide-slate-200 min-w-0">
                              {msg.tools.map((t, idx) => (
                                <div key={`${t.name}_${idx}`} className="p-3 space-y-1.5 text-xs min-w-0">
                                  <div className="font-mono font-medium text-slate-800 break-words">
                                    {t.name}
                                  </div>
                                  <pre className="max-w-full text-[11px] font-mono text-slate-500 overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                    Args: {JSON.stringify(t.args, null, 2)}
                                  </pre>
                                  {t.result !== undefined && (
                                    <pre className="max-w-full text-[11px] font-mono text-slate-700 bg-slate-50 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                      {JSON.stringify(t.result, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {msg.content && (
                        <div
                          className={
                            msg.role === 'user'
                              ? 'break-words [overflow-wrap:anywhere]'
                              : 'text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
                          }
                        >
                          {msg.content}
                        </div>
                      )}

                      {msg.role === 'assistant' && !msg.content && !msg.error && streaming && (
                        <div className="text-xs text-slate-500 break-words">
                          {msg.statusText || 'Generating response...'}
                        </div>
                      )}

                      {msg.error && (
                        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 break-words [overflow-wrap:anywhere]">
                          {msg.error}
                        </div>
                      )}

                      {msg.pendingActions && msg.pendingActions.length > 0 && (
                        <div className="space-y-3 pt-1 min-w-0">
                          {msg.pendingActions.map((pa) => {
                            const latest = pendingMap[pa.id] ?? pa;
                            return (
                              <ApprovalCard
                                key={pa.id}
                                action={latest}
                                onApprove={onApproveAction}
                                onReject={onRejectAction}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3 sm:py-4">
          <div className="max-w-3xl mx-auto min-w-0">
            <div className="flex items-end gap-2 sm:gap-3 min-w-0">
              <textarea
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Give the recipient, message, or task..."
                className="flex-1 min-w-0 resize-none px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
              <button
                type="button"
                disabled={streaming || !input.trim()}
                onClick={() => void sendMessage()}
                className="min-h-[44px] sm:h-10 sm:min-h-0 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{streaming ? 'Sending...' : 'Send'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
