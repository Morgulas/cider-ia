import { Pipe, PipeTransform } from '@angular/core';
import { registerHandlebarsHelpers } from '../utils/handlebars-helpers';
import * as Handlebars from 'handlebars';

@Pipe({ name: 'handlebars' })
export class HandlebarsPipe implements PipeTransform {
  private static compiledTemplates = new Map<string, Handlebars.TemplateDelegate>();
  private static readonly MAX_CACHE_SIZE = 500;



  constructor() {
    registerHandlebarsHelpers();
  }

  transform(handlebars: string, assetUrls?: any): string {
    return this.sanitizeCss(this.executeHandlebars(handlebars, assetUrls));
  }

  private executeHandlebars(handlebars: string, assetUrls?: any): string {
    if (!handlebars) {
      return '';
    }
    
    let template = HandlebarsPipe.compiledTemplates.get(handlebars);
    if (!template) {
      if (HandlebarsPipe.compiledTemplates.size >= HandlebarsPipe.MAX_CACHE_SIZE) {
        HandlebarsPipe.compiledTemplates.clear();
      }
      template = Handlebars.compile(handlebars);
      HandlebarsPipe.compiledTemplates.set(handlebars, template);
    }


    try {
      return template({ assets: assetUrls });
    } catch (error) {
      return '';
    }
  }


  private sanitizeCss(css: string): string {
    if (!css) {
      return '';
    }
    return css.replace(/!important/g, '');
  }

}
