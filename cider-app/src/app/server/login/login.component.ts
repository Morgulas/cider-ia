import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { Password } from 'primeng/password';
import { AuthService } from '../auth.service';
import { apiErrorMessage } from '../server.types';

/**
 * Login page, and first setup page (route data "mode": "setup") where the
 * administrator account is created when the server has no account yet.
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  imports: [FormsModule, Button, InputText, Password, Message, TranslatePipe]
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected readonly setupMode = this.route.snapshot.data['mode'] === 'setup';
  protected username = '';
  protected password = '';
  protected passwordConfirm = '';
  protected setupToken = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.error.set(null);
    if (this.setupMode && this.password !== this.passwordConfirm) {
      this.error.set(this.translate.instant('server.login.passwords-differ'));
      return;
    }
    this.busy.set(true);
    try {
      if (this.setupMode) {
        await this.auth.setup(this.username.trim(), this.password, this.setupToken.trim());
      } else {
        await this.auth.login(this.username.trim(), this.password);
      }
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')
        ? returnUrl : '/projects');
    } catch (error) {
      const unreachable = error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 502);
      this.error.set(unreachable
        ? this.translate.instant('server.login.server-unreachable')
        : apiErrorMessage(error, this.translate.instant('server.login.server-unreachable')));
    } finally {
      this.busy.set(false);
      this.password = '';
      this.passwordConfirm = '';
    }
  }
}
