import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PublicUser } from './server.types';

/**
 * Who is logged in. The session itself is an HttpOnly cookie that the page
 * cannot read: the server tells who it belongs to.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly user = signal<PublicUser | null>(null);
  /** true until the first administrator account has been created */
  readonly setupRequired = signal(false);
  readonly isAdmin = computed(() => this.user()?.isAdmin === true);

  /** Asks the server for the current session (called at startup) */
  async refresh(): Promise<void> {
    try {
      const status = await firstValueFrom(this.http.get<{ setupRequired: boolean; user: PublicUser | null }>('/api/auth/status'));
      this.setupRequired.set(status.setupRequired);
      this.user.set(status.user);
    } catch {
      // server unreachable: stay logged out, the login page shows the error
      this.user.set(null);
    }
  }

  /** Creates the first administrator; setupToken is the code printed in the server logs */
  async setup(username: string, password: string, setupToken: string): Promise<void> {
    const result = await firstValueFrom(this.http.post<{ user: PublicUser }>('/api/auth/setup',
      { username, password, setupToken }));
    this.setupRequired.set(false);
    this.user.set(result.user);
  }

  async login(username: string, password: string): Promise<void> {
    const result = await firstValueFrom(this.http.post<{ user: PublicUser }>('/api/auth/login', { username, password }));
    this.user.set(result.user);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } finally {
      this.user.set(null);
    }
  }

  changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/auth/password', { currentPassword, newPassword }));
  }

  /** The server answered 401 to a regular call: the session is over */
  sessionExpired(): void {
    this.user.set(null);
  }
}
