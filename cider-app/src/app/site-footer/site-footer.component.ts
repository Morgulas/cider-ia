import { Component, OnInit } from '@angular/core';
import PackageUtils from '../shared/utils/package-utils';
import { Bind } from 'primeng/bind';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';

@Component({
    selector: 'app-site-footer',
    templateUrl: './site-footer.component.html',
    styleUrls: ['./site-footer.component.scss'],
    imports: [Bind, Button, Tooltip]
})
export class SiteFooterComponent implements OnInit {
  appVersion = '0.0.0';

  constructor() {
    this.appVersion = PackageUtils.getVersion();
  }

  ngOnInit(): void {
  }

  /** Source of this modified version (AGPL-3.0 section 13): the fork, not the original */
  navigateToGithub() {
    window.open('https://github.com/Morgulas/cider-ia', "_blank");
  }
  navigateToUserGuide() {
    window.open('https://oatear.github.io/cider-docs/docs/overview', "_blank");
  }
  navigateToDiscord() {
    window.open('https://discord.gg/S66xw9Wc9V', "_blank");
  }

}
