/**
 * Conversation Manager - Episodic conversation memory
 *
 * Stores conversations and messages in Supabase.
 * Implements context compression via summaries.
 */

const RECENT_MESSAGE_LIMIT = 20;
const SUMMARY_TRIGGER_COUNT = 30;

export class ConversationManager {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async listConversations(userId) {
    const { data, error } = await this.supabase
      .from('ai_conversations')
      .select('id, title, summary, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(`List conversations failed: ${error.message}`);
    return data || [];
  }

  async createConversation(userId, title = null) {
    const { data, error } = await this.supabase
      .from('ai_conversations')
      .insert({
        user_id: userId,
        title: title || 'New conversation',
      })
      .select('id, title, summary, created_at, updated_at')
      .single();

    if (error) throw new Error(`Create conversation failed: ${error.message}`);
    return data;
  }

  async deleteConversation(conversationId, userId) {
    const { error } = await this.supabase
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);

    if (error) throw new Error(`Delete conversation failed: ${error.message}`);
  }

  async getMessages(conversationId, userId) {
    const { data, error } = await this.supabase
      .from('ai_messages')
      .select('id, role, content, tool_calls, tool_name, token_count, created_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw new Error(`Get messages failed: ${error.message}`);
    return data || [];
  }

  async addMessage(conversationId, userId, role, content, metadata = {}) {
    const { data, error } = await this.supabase
      .from('ai_messages')
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role,
        content,
        tool_calls: metadata.toolCalls || null,
        tool_name: metadata.toolName || null,
        token_count: metadata.tokenCount || null,
      })
      .select('id, role, content, created_at')
      .single();

    if (error) throw new Error(`Add message failed: ${error.message}`);

    // Update conversation's updated_at
    await this.supabase
      .from('ai_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId);

    return data;
  }

  /**
   * Get recent messages for working memory (context window).
   * Returns the last N messages, respecting token limits.
   */
  async getRecentMessages(conversationId, userId, limit = RECENT_MESSAGE_LIMIT) {
    const { data, error } = await this.supabase
      .from('ai_messages')
      .select('role, content, tool_calls, tool_name')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Get recent messages failed: ${error.message}`);

    // Reverse to chronological order
    return (data || []).reverse();
  }

  /**
   * Get the conversation summary for context compression.
   */
  async getConversationSummary(conversationId, userId) {
    const { data, error } = await this.supabase
      .from('ai_conversations')
      .select('summary')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(`Get summary failed: ${error.message}`);
    return data?.summary || null;
  }

  /**
   * Update the conversation summary (context compression).
   */
  async updateSummary(conversationId, userId, summary) {
    const { error } = await this.supabase
      .from('ai_conversations')
      .update({ summary, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId);

    if (error) throw new Error(`Update summary failed: ${error.message}`);
  }

  /**
   * Count messages in a conversation.
   */
  async countMessages(conversationId, userId) {
    const { count, error } = await this.supabase
      .from('ai_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (error) throw new Error(`Count messages failed: ${error.message}`);
    return count || 0;
  }

  /**
   * Check if summary should be generated (context compression trigger).
   */
  shouldCompress(messageCount) {
    return messageCount >= SUMMARY_TRIGGER_COUNT;
  }

  /**
   * Update title if it's still the default.
   */
  async updateTitleIfDefault(conversationId, userId, userMessage) {
    const title = userMessage.slice(0, 60).trim() || 'New conversation';

    const { error } = await this.supabase
      .from('ai_conversations')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('title', 'New conversation');

    if (error) {
      console.warn('[Conversation] Title update failed:', error.message);
    }
  }
}