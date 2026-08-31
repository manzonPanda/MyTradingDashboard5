import { Injectable, signal, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

export interface AuraConversation {
  id: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuraMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: any;
  tool_name?: string | null;
  token_count?: number | null;
  created_at: string;
}

export interface AuraMemory {
  id: string;
  memory: string;
  memory_type: string;
  importance: number;
  source: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuraInsight {
  id: string;
  insight_type: string;
  title: string;
  content: string;
  severity: 'info' | 'warning' | 'critical' | 'positive';
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
}

export interface AuraToolCall {
  name: string;
  args: any;
}

export interface AuraToolResult {
  name: string;
  result: any;
}

export interface AuraChatEvent {
  type: 'conversation_created' | 'tool_call' | 'tool_result' | 'token' | 'thinking' | 'done' | 'error';
  data: any;
}

@Injectable({ providedIn: 'root' })
export class AuraAiService {
  private readonly supabaseService = inject(SupabaseService);

  readonly conversations = signal<AuraConversation[]>([]);
  readonly messages = signal<AuraMessage[]>([]);
  readonly memories = signal<AuraMemory[]>([]);
  readonly insights = signal<AuraInsight[]>([]);
  readonly isStreaming = signal(false);
  readonly streamingContent = signal('');
  readonly activeToolCalls = signal<AuraToolCall[]>([]);
  readonly isThinking = signal(false);
  readonly thinkingInfo = signal<string>('');
  /** Last chat failure, surfaced in the UI. Never silently swallowed. */
  readonly lastError = signal<string | null>(null);
  readonly lastTokenInfo = signal<{ inputTokens: number; outputTokens: number; totalTokens: number } | null>(null);
  readonly conversationTokens = signal<{ inputTokens: number; outputTokens: number; totalTokens: number }>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

  private readonly backendUrl = environment.backendUrlAura;
  private currentConversationId: string | null = null;

  private async getAuthHeaders(): Promise<HeadersInit> {
    const { data } = await this.supabaseService.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not authenticated');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private getApiBase(): string {
    return `${this.backendUrl}/api/aura`;
  }

  // ─── Conversations ──────────────────────────────────────────

  async loadConversations(): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/conversations`, { headers });
      if (!response.ok) throw new Error('Failed to load conversations');
      const data = await response.json();
      this.conversations.set(data);
    } catch (err) {
      console.error('[AURA] Load conversations failed:', err);
    }
  }

  async createConversation(title?: string): Promise<AuraConversation | null> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/conversations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('Failed to create conversation');
      const conversation = await response.json();
      await this.loadConversations();
      return conversation;
    } catch (err) {
      console.error('[AURA] Create conversation failed:', err);
      return null;
    }
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await fetch(`${this.getApiBase()}/conversations/${id}`, {
        method: 'DELETE',
        headers,
      });
      await this.loadConversations();
      if (this.currentConversationId === id) {
        this.currentConversationId = null;
        this.messages.set([]);
      }
    } catch (err) {
      console.error('[AURA] Delete conversation failed:', err);
    }
  }

  async loadMessages(conversationId: string): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/conversations/${conversationId}/messages`, { headers });
      if (!response.ok) throw new Error('Failed to load messages');
      const data = await response.json();
      this.messages.set(data);
      this.currentConversationId = conversationId;
    } catch (err) {
      console.error('[AURA] Load messages failed:', err);
    }
  }

  setCurrentConversation(id: string | null): void {
    this.currentConversationId = id;
    // Reset conversation token counter when switching
    this.conversationTokens.set({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    if (id) {
      this.loadMessages(id);
    } else {
      this.messages.set([]);
    }
  }

  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  // ─── Chat (SSE streaming) ────────────────────────────────────

  async sendMessage(options: {
    message: string;
    conversationId?: string | null;
    accountId?: string | null;
    onEvent?: (event: AuraChatEvent) => void;
  }): Promise<void> {
    const { message, conversationId, accountId, onEvent } = options;
    this.isStreaming.set(true);
    this.streamingContent.set('');
    this.activeToolCalls.set([]);
    this.isThinking.set(true);
    this.lastError.set(null); // clear any previous failure banner

    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationId, message, accountId }),
      });

      if (!response.ok) {
        // Surface backend validation errors (e.g. 403 account-not-owned).
        let detail = `Chat request failed: ${response.status}`;
        try {
          const body = await response.json();
          if (body?.error) detail = body.error;
        } catch {
          // keep the generic detail
        }
        throw new Error(detail);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              this.handleSSEEvent(currentEvent, data, onEvent);
            } catch {
              // Ignore parse errors
            }
            currentEvent = '';
          }
        }
      }
    } catch (err) {
      console.error('[AURA] Chat failed:', err);
      const messageText = err instanceof Error ? err.message : 'Unknown error';
      // Errors are surfaced in the UI via lastError — never silently dropped.
      this.lastError.set(messageText);
      onEvent?.({ type: 'error', data: { message: messageText } });
    } finally {
      this.isStreaming.set(false);
      this.isThinking.set(false);
      this.activeToolCalls.set([]);
    }
  }

  private handleSSEEvent(event: string, data: any, onEvent?: (e: AuraChatEvent) => void): void {
    switch (event) {
      case 'conversation_created':
        this.currentConversationId = data.id;
        onEvent?.({ type: 'conversation_created', data });
        break;

      case 'tool_call':
        this.activeToolCalls.update(calls => [...calls, { name: data.name, args: data.args }]);
        onEvent?.({ type: 'tool_call', data });
        break;

      case 'tool_result':
        onEvent?.({ type: 'tool_result', data });
        break;

      case 'token':
        this.isThinking.set(false);
        this.streamingContent.update(content => content + data.token);
        onEvent?.({ type: 'token', data });
        break;

      case 'thinking':
        this.isThinking.set(true);
        this.thinkingInfo.set(data.message || '');
        onEvent?.({ type: 'thinking', data });
        break;

      case 'done':
        this.isThinking.set(false);
        // Add the complete response to messages
        if (data.content) {
          this.messages.update(msgs => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.content,
              created_at: new Date().toISOString(),
              token_count: data.totalTokens,
            } as AuraMessage,
          ]);
        }
        this.streamingContent.set('');
        if (data.conversationId) {
          this.currentConversationId = data.conversationId;
        }
        // Store token info for display
        if (data.inputTokens !== undefined) {
          this.lastTokenInfo.set({
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            totalTokens: data.totalTokens,
          });
          // Accumulate conversation tokens
          this.conversationTokens.update(ct => ({
            inputTokens: ct.inputTokens + data.inputTokens,
            outputTokens: ct.outputTokens + data.outputTokens,
            totalTokens: ct.totalTokens + data.totalTokens,
          }));
        }
        onEvent?.({ type: 'done', data });
        break;

      case 'error':
        this.isThinking.set(false);
        // Errors are surfaced in the UI via lastError — never silently dropped.
        this.lastError.set(data?.message || 'AURA request failed.');
        onEvent?.({ type: 'error', data });
        break;
    }
  }

  // ─── Memories ────────────────────────────────────────────────

  async loadMemories(): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/memories`, { headers });
      if (!response.ok) throw new Error('Failed to load memories');
      const data = await response.json();
      this.memories.set(data);
    } catch (err) {
      console.error('[AURA] Load memories failed:', err);
    }
  }

  async saveMemory(memory: string, memoryType: string, importance: number = 5): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await fetch(`${this.getApiBase()}/memories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ memory, memoryType, importance }),
      });
      await this.loadMemories();
    } catch (err) {
      console.error('[AURA] Save memory failed:', err);
    }
  }

  async updateMemory(id: string, updates: Partial<AuraMemory>): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await fetch(`${this.getApiBase()}/memories/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updates),
      });
      await this.loadMemories();
    } catch (err) {
      console.error('[AURA] Update memory failed:', err);
    }
  }

  async deleteMemory(id: string): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await fetch(`${this.getApiBase()}/memories/${id}`, {
        method: 'DELETE',
        headers,
      });
      await this.loadMemories();
    } catch (err) {
      console.error('[AURA] Delete memory failed:', err);
    }
  }

  // ─── Insights ────────────────────────────────────────────────

  async loadInsights(): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/insights`, { headers });
      if (!response.ok) throw new Error('Failed to load insights');
      const data = await response.json();
      this.insights.set(data);
    } catch (err) {
      console.error('[AURA] Load insights failed:', err);
    }
  }

  async markInsightRead(id: string): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await fetch(`${this.getApiBase()}/insights/${id}/read`, {
        method: 'PATCH',
        headers,
      });
      await this.loadInsights();
    } catch (err) {
      console.error('[AURA] Mark insight read failed:', err);
    }
  }

  async dismissInsight(id: string): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      await fetch(`${this.getApiBase()}/insights/${id}/dismiss`, {
        method: 'PATCH',
        headers,
      });
      await this.loadInsights();
    } catch (err) {
      console.error('[AURA] Dismiss insight failed:', err);
    }
  }

  // ─── Proactive check ─────────────────────────────────────────

  async runProactiveCheck(): Promise<any[]> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.getApiBase()}/proactive/check`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Proactive check failed');
      const data = await response.json();
      return data.events || [];
    } catch (err) {
      console.error('[AURA] Proactive check failed:', err);
      return [];
    }
  }

  // ─── Health check ────────────────────────────────────────────

  /**
   * Health check with small retry budget — serverless hosts (e.g. Render free
   * tier) cold-start slowly, and a single immediate request would wrongly
   * report the backend as offline.
   */
  async checkHealth(attempts = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(`${this.getApiBase()}/health`);
        if (response.ok) return true;
      } catch {
        // fall through to retry
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    return false;
  }
}
