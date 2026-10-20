import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Button } from 'primeng/button';
import { Checkbox } from 'primeng/checkbox';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { TableModule } from 'primeng/table';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import { AuthService } from '../auth.service';
import { apiErrorMessage, PublicUser } from '../server.types';
import { TopbarComponent } from '../topbar/topbar.component';
import { UsersApiService } from '../users-api.service';

/** Account administration, for administrators */
@Component({
  selector: 'app-admin-users',
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
  providers: [ConfirmationService],
  imports: [TopbarComponent, FormsModule, TableModule, Button, Checkbox, Dialog, InputText, Password, Message, Tag,
    Tooltip, ConfirmDialog, DatePipe, TranslatePipe]
})
export class AdminUsersComponent implements OnInit {
  private readonly api = inject(UsersApiService);
  protected readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly users = signal<PublicUser[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected createDialogVisible = false;
  protected newUsername = '';
  protected newPassword = '';
  protected newIsAdmin = false;

  protected passwordDialogVisible = false;
  protected passwordTarget: PublicUser | null = null;
  protected resetPassword = '';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.users.set(await this.api.list());
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async run(action: () => Promise<unknown>, infoKey?: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      await action();
      if (infoKey) {
        this.info.set(this.translate.instant(infoKey));
      }
      await this.refresh();
      return true;
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected isSelf(user: PublicUser): boolean {
    return user.id === this.auth.user()?.id;
  }

  protected openCreateDialog(): void {
    this.newUsername = '';
    this.newPassword = '';
    this.newIsAdmin = false;
    this.createDialogVisible = true;
  }

  protected async create(): Promise<void> {
    if (await this.run(() => this.api.create(this.newUsername.trim(), this.newPassword, this.newIsAdmin))) {
      this.createDialogVisible = false;
    }
    this.newPassword = '';
  }

  protected openPasswordDialog(user: PublicUser): void {
    this.passwordTarget = user;
    this.resetPassword = '';
    this.passwordDialogVisible = true;
  }

  protected async savePassword(): Promise<void> {
    const target = this.passwordTarget;
    if (target && await this.run(() => this.api.update(target.id, { password: this.resetPassword }),
      'server.admin.password-reset-done')) {
      this.passwordDialogVisible = false;
    }
    this.resetPassword = '';
  }

  protected toggleAdmin(user: PublicUser): void {
    void this.run(() => this.api.update(user.id, { isAdmin: !user.isAdmin }));
  }

  protected toggleDisabled(user: PublicUser): void {
    void this.run(() => this.api.update(user.id, { disabled: !user.disabled }));
  }

  protected confirmDelete(user: PublicUser): void {
    this.confirmation.confirm({
      header: this.translate.instant('server.admin.delete-title'),
      message: this.translate.instant('server.admin.delete-confirm', { name: user.username }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => void this.run(() => this.api.delete(user.id))
    });
  }
}
