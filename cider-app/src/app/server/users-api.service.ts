import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PublicUser } from './server.types';

/** Account administration (administrators only) */
@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private readonly http = inject(HttpClient);

  async list(): Promise<PublicUser[]> {
    return (await firstValueFrom(this.http.get<{ users: PublicUser[] }>('/api/users'))).users;
  }

  async create(username: string, password: string, isAdmin: boolean): Promise<PublicUser> {
    return (await firstValueFrom(this.http.post<{ user: PublicUser }>('/api/users', { username, password, isAdmin }))).user;
  }

  async update(id: string, changes: { password?: string; isAdmin?: boolean; disabled?: boolean }): Promise<PublicUser> {
    return (await firstValueFrom(this.http.patch<{ user: PublicUser }>(`/api/users/${id}`, changes))).user;
  }

  delete(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/users/${id}`));
  }
}
