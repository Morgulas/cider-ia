import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { Bind } from 'primeng/bind';
import { Menubar } from 'primeng/menubar';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'app-site-activitybar',
    templateUrl: './site-activitybar.component.html',
    styleUrl: './site-activitybar.component.scss',
    imports: [Bind, Menubar, SettingsDialogComponent]
})
export class SiteActivitybarComponent {
  private activity = 'explorer';
  @Input() set selectedActivity(value: string) {
    this.activity = value;
    this.menuItems = this.buildMenu();
  }
  get selectedActivity(): string {
    return this.activity;
  }
  @Output() selectedActivityChange: EventEmitter<string> = new EventEmitter<string>();

  public settingsDialogVisible = false;
  public menuItems: MenuItem[] = [];

  /** Panel entries toggle the sidebar on their panel; page entries close it */
  private buildMenu(): MenuItem[] {
    const t = (key: string) => this.translate.instant(key);
    const tooltip = (label: string) => ({
      tooltipLabel: label, tooltipPosition: 'right' as const, showDelay: 500, hideDelay: 500
    });
    const panel = (id: string, label: string, icon: string): MenuItem => ({
      label, icon,
      tooltipOptions: tooltip(label),
      styleClass: this.activity === id ? 'activity-active' : '',
      command: () => this.select(this.activity === id ? '' : id)
    });
    const page = (label: string, icon: string, url: string): MenuItem => ({
      label, icon,
      tooltipOptions: tooltip(label),
      command: () => {
        this.select('');
        this.router.navigate([url]);
      }
    });
    return [
      panel('explorer', t('activity.explorer'), 'pi pi-fw pi-folder'),
      panel('assets', t('activity.illustrations'), 'pi pi-fw pi-images'),
      page(t('activity.simulator'), 'pi pi-fw pi-crown', '/simulator'),
      {
        label: t('activity.settings'),
        icon: 'pi pi-fw pi-cog',
        tooltipOptions: tooltip(t('activity.settings')),
        styleClass: 'menu-item-bottom',
        command: () => {
          this.settingsDialogVisible = true;
        }
      },
    ];
  }

  private select(activity: string) {
    this.selectedActivity = activity;
    this.selectedActivityChange.emit(activity);
  }

  constructor(private router: Router, private translate: TranslateService) {
    this.menuItems = this.buildMenu();
    // labels follow the language
    this.translate.stream('activity.explorer').pipe(takeUntilDestroyed()).subscribe(() => this.menuItems = this.buildMenu());
  }


}
