import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { AuthService } from '../auth.service';
import { apiErrorMessage } from '../server.types';
import { TopbarComponent } from '../topbar/topbar.component';

/** The logged-in user's account: change the password */
@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  styleUrl: './account.component.scss',
  imports: [TopbarComponent, FormsModule, Button, Password, Message, TranslatePipe]
})
export class AccountComponent {
  protected readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected async changePassword(): Promise<void> {
    this.error.set(null);
    this.info.set(null);
    if (this.newPassword !== this.confirmPassword) {
      this.error.set(this.translate.instant('server.login.passwords-differ'));
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.info.set(this.translate.instant('server.account.changed'));
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.busy.set(false);
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
    }
  }
}
