import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router } from '@angular/router';
import { MenuItem } from 'primeng/api';
import { Bind } from 'primeng/bind';
import { Menubar } from 'primeng/menubar';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';

@Component({
    selector: 'app-site-activitybar',
    templateUrl: './site-activitybar.component.html',
    styleUrl: './site-activitybar.component.scss',
    imports: [Bind, Menubar, SettingsDialogComponent]
})
export class SiteActivitybarComponent {
  @Input() selectedActivity = 'explorer';
  @Output() selectedActivityChange: EventEmitter<string> = new EventEmitter<string>();

  public settingsDialogVisible = false;
  public menuItems: MenuItem[] = [
    {
      label: 'Explorer',
      icon: 'pi pi-fw pi-folder',
      tooltipOptions: {
        tooltipLabel: 'Explorer',
        tooltipPosition: 'right',
        showDelay: 500,
        hideDelay: 500
      },
      command: () => {
        if (this.selectedActivity == 'explorer') {
          this.selectedActivity = '';
        } else {
          this.selectedActivity = 'explorer';
        }
        this.selectedActivityChange.emit(this.selectedActivity);
        // console.log('Explorer activity selected:', this.selectedActivity);
      }
    },
    // {
    //   label: 'Source Control',
    //   icon: 'pi pi-fw pi-share-alt',
    //   tooltipOptions: {
    //     tooltipLabel: 'Source Control',
    //     tooltipPosition: 'right',
    //     showDelay: 500,
    //     hideDelay: 500
    //   },
    //   command: () => {
    //     if (this.selectedActivity == 'source-control') {
    //       this.selectedActivity = '';
    //     } else {
    //       this.selectedActivity = 'source-control';
    //     }
    //     this.selectedActivityChange.emit(this.selectedActivity);
    //     console.log('Source Control activity selected:', this.selectedActivity);
    //   }
    // },
    // {
    //   label: 'AI Tools',
    //   icon: 'pi pi-fw pi-sparkles',
    //   tooltipOptions: {
    //     tooltipLabel: 'AI Tools',
    //     tooltipPosition: 'right',
    //     showDelay: 500,
    //     hideDelay: 500
    //   },
    //   command: () => {
    //     if (this.selectedActivity == 'ai-tools') {
    //       this.selectedActivity = '';
    //     } else {
    //       this.selectedActivity = 'ai-tools';
    //     }
    //     this.selectedActivityChange.emit(this.selectedActivity);
    //   }
    // },
    // {
    //   label: 'Create New Project',
    //   icon: 'pi pi-fw pi-plus',
    //   tooltipOptions: {
    //     tooltipLabel: 'Create New Project',
    //     tooltipPosition: 'right',
    //     showDelay: 500,
    //     hideDelay: 500
    //   },
    //   command: () => {
    //     this.router.navigate(['/welcome']);
    //   }
    // },
    {
      label: 'Game Simulator',
      icon: 'pi pi-fw pi-crown',
      tooltipOptions: {
        tooltipLabel: 'Game Simulator',
        tooltipPosition: 'right',
        showDelay: 500,
        hideDelay: 500
      },
      command: () => {
        this.selectedActivity = '';
        this.selectedActivityChange.emit(this.selectedActivity);
        this.router.navigate(['/simulator']);
      }
    },
    {
      label: 'Settings',
      icon: 'pi pi-fw pi-cog',
      tooltipOptions: {
        tooltipLabel: 'Settings',
        tooltipPosition: 'right',
        showDelay: 500,
        hideDelay: 500
      },
      styleClass: 'menu-item-bottom',
      command: () => {
        this.settingsDialogVisible = true;
      }
    },
  ];

  constructor(private router: Router) {
    // Do nothing here
  }


}
