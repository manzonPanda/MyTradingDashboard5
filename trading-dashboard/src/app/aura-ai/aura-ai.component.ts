import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, inject, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuraAiService, AuraMessage } from '../services/aura-ai.service';
import { trigger, transition, style, animate } from '@angular/animations';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: string[];
  timestamp: Date;
}

@Component({
  selector: 'app-aura-ai',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './aura-ai.component.html',
  styleUrl: './aura-ai.component.scss',
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
    ]),
  ],
})
export class AuraAiComponent implements OnInit, OnDestroy, AfterViewChecked {
  private readonly auraService = inject(AuraAiService);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('messageContainer') messageContainer?: ElementRef;
  @ViewChild('chatInput') chatInput?: ElementRef<HTMLTextAreaElement>;

  inputMessage = '';
  showSidebar = true;
  showMemoryPanel = false;
  isBackendHealthy = false;
  private shouldScrollToBottom = false;

  get messages() {
    return this.auraService.messages();
  }

  get conversations() {
    return this.auraService.conversations();
  }

  get memories() {
    return this.auraService.memories();
  }

  get isStreaming() {
    return this.auraService.isStreaming();
  }

  get isThinking() {
    return this.auraService.isThinking();
  }

  get thinkingInfo() {
    return this.auraService.thinkingInfo();
  }

  get streamingContent() {
    return this.auraService.streamingContent();
  }

  get activeToolCalls() {
    return this.auraService.activeToolCalls();
  }

  get currentConversationId() {
    return this.auraService.getCurrentConversationId();
  }

  get lastTokenInfo() {
    return this.auraService.lastTokenInfo();
  }

  get conversationTokens() {
    return this.auraService.conversationTokens();
  }

  ngOnInit(): void {
    this.loadInitialData();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  private async loadInitialData(): Promise<void> {
    this.isBackendHealthy = await this.auraService.checkHealth();
    if (this.isBackendHealthy) {
      await this.auraService.loadConversations();
      await this.auraService.loadMemories();
    }
    this.cdr.markForCheck();
  }

  async sendMessage(): Promise<void> {
    const message = this.inputMessage.trim();
    if (!message || this.isStreaming) return;

    // Add user message to local display immediately
    const userMsg: AuraMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };
    this.auraService.messages.update(msgs => [...msgs, userMsg]);

    this.inputMessage = '';
    this.shouldScrollToBottom = true;

    await this.auraService.sendMessage(message, this.currentConversationId || undefined);
    this.shouldScrollToBottom = true;
    this.cdr.markForCheck();

    // Reload conversations to update sidebar
    await this.auraService.loadConversations();
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  useSuggestion(suggestion: string): void {
    this.inputMessage = suggestion;
    this.sendMessage();
  }

  async newChat(): Promise<void> {
    this.auraService.setCurrentConversation(null);
    this.inputMessage = '';
    this.cdr.markForCheck();
  }

  async selectConversation(id: string): Promise<void> {
    this.auraService.setCurrentConversation(id);
    this.shouldScrollToBottom = true;
    this.cdr.markForCheck();
  }

  async deleteConversation(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    await this.auraService.deleteConversation(id);
    this.cdr.markForCheck();
  }

  toggleSidebar(): void {
    this.showSidebar = !this.showSidebar;
  }

  toggleMemoryPanel(): void {
    this.showMemoryPanel = !this.showMemoryPanel;
    if (this.showMemoryPanel) {
      this.auraService.loadMemories();
    }
  }

  async deleteMemory(id: string, event: Event): Promise<void> {
    event.stopPropagation();
    await this.auraService.deleteMemory(id);
    this.cdr.markForCheck();
  }

  async toggleMemoryActive(memory: any, event: Event): Promise<void> {
    event.stopPropagation();
    await this.auraService.updateMemory(memory.id, { is_active: !memory.is_active });
    this.cdr.markForCheck();
  }

  copyMessage(content: string): void {
    navigator.clipboard.writeText(content).then(() => {
      // Could show a toast here
    });
  }

  trackByMessage(index: number, msg: AuraMessage): string {
    return msg.id;
  }

  trackByConversation(index: number, conv: any): string {
    return conv.id;
  }

  trackByMemory(index: number, mem: any): string {
    return mem.id;
  }

  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getMemoryTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      preference: 'tune',
      trading_rule: 'rule',
      behavior: 'psychology',
      goal: 'flag',
      fact: 'info',
      strategy: 'route',
      conversation: 'chat',
      insight: 'lightbulb',
    };
    return icons[type] || 'info';
  }

  private scrollToBottom(): void {
    if (this.messageContainer) {
      const el = this.messageContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }
}