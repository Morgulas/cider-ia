import { Component, OnInit } from '@angular/core';
import PackageUtils from '../shared/utils/package-utils';
import { Bind } from 'primeng/bind';
import { Button } from 'primeng/button';

@Component({
    selector: 'app-site-footer',
    templateUrl: './site-footer.component.html',
    styleUrls: ['./site-footer.component.scss'],
    imports: [Bind, Button]
})
export class SiteFooterComponent implements OnInit {
  appVersion: string = '0.0.0';

  constructor() {
    this.appVersion = PackageUtils.getVersion();
  }

  ngOnInit(): void {
  }

  navigateToGithub() {
    window.open('https://github.com/oatear/cider', "_blank");
  }
  navigateToUserGuide() {
    window.open('https://oatear.github.io/cider-docs/docs/overview', "_blank");
  }
  navigateToDiscord() {
    window.open('https://discord.gg/S66xw9Wc9V', "_blank");
  }

}
