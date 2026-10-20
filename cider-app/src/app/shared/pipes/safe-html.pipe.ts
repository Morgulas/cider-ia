import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import HtmlSanitizer from '../utils/html-sanitizer';

@Pipe({
    name: 'safeHtml',
    standalone: false
})
export class SafeHtmlPipe implements PipeTransform {

  constructor(private sanitizer: DomSanitizer) { }
  
    transform(value: string): SafeHtml {
      return this.sanitizer.bypassSecurityTrustHtml(HtmlSanitizer.sanitizeHtml(value));
    }

}
