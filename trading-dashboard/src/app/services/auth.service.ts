import { Injectable, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session = signal<Session | null>(null);
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor(private readonly supabaseService: SupabaseService) {
    void this.initialize();
    this.supabaseService.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.user.set(session?.user ?? null);
      this.loading.set(false);
    });
  }

  private async initialize(): Promise<void> {
    const { data, error } = await this.supabaseService.client.auth.getSession();
    if (error) this.error.set(error.message);
    this.session.set(data.session);
    this.user.set(data.session?.user ?? null);
    this.loading.set(false);
  }

  async signIn(email: string, password: string): Promise<void> {
    this.error.set(null);
    const { error } = await this.supabaseService.client.auth.signInWithPassword({ email, password });
    if (error) throw this.setError(error.message);
  }

  async signUp(email: string, password: string): Promise<boolean> {
    this.error.set(null);
    const { data, error } = await this.supabaseService.client.auth.signUp({ email, password });
    if (error) throw this.setError(error.message);
    return !data.session;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabaseService.client.auth.signOut();
    if (error) throw this.setError(error.message);
  }

  private setError(message: string): Error {
    this.error.set(message);
    return new Error(message);
  }
}
