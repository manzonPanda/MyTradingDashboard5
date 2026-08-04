import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss']
})
export class AuthComponent {
  email = '';
  password = '';
  isSignUp = false;
  submitting = false;
  message = '';

  constructor(readonly auth: AuthService) {}

  async submit(): Promise<void> {
    this.message = '';
    if (!this.email.trim() || this.password.length < 6) {
      this.message = 'Enter a valid email and a password with at least 6 characters.';
      return;
    }
    this.submitting = true;
    try {
      if (this.isSignUp) {
        const needsConfirmation = await this.auth.signUp(this.email.trim(), this.password);
        this.message = needsConfirmation ? 'Check your email to confirm your account.' : 'Account created.';
      } else {
        await this.auth.signIn(this.email.trim(), this.password);
      }
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Authentication failed.';
    } finally {
      this.submitting = false;
    }
  }

  toggleMode(): void {
    this.isSignUp = !this.isSignUp;
    this.message = '';
  }
}
