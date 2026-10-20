import DOMPurify from 'dompurify';

/**
 * URLs allowed in src/href attributes: the DOMPurify defaults (http(s), mailto, relative...)
 * plus blob: URLs, which is how project assets are served (URL.createObjectURL).
 * data: URLs stay limited to DOMPurify's media tags (img, audio, video...).
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Sanitizes untrusted HTML before it is injected into the page.
 *
 * Card templates, card data (spreadsheet cells), imported projects and, later,
 * AI-generated templates are all untrusted: they may contain scripts, inline
 * event handlers (onerror, onload...) or javascript: URLs. Those are removed,
 * while the markup card designers rely on is kept: layout tags, inline styles,
 * <style> blocks, classes, data attributes, inline SVG and asset images.
 */
export default class HtmlSanitizer {
  private static hooksInstalled = false;

  /**
   * <use> is needed by inline SVG (generated symbols reuse shapes with <use href="#id">)
   * but DOMPurify removes it by default because it can load external documents.
   * Allow it, restricted to same-document references.
   */
  private static installHooks() {
    if (HtmlSanitizer.hooksInstalled) {
      return;
    }
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (node.nodeName.toLowerCase() === 'use'
        && (data.attrName === 'href' || data.attrName === 'xlink:href')
        && !data.attrValue.trim().startsWith('#')) {
        data.keepAttr = false;
      }
    });
    HtmlSanitizer.hooksInstalled = true;
  }

  /**
   * Sanitize an HTML fragment (card template output, may contain <style> blocks)
   */
  static sanitizeHtml(html: string): string {
    if (!html) {
      return '';
    }
    HtmlSanitizer.installHooks();
    return DOMPurify.sanitize(html, {
      // keep a leading <style> block in the fragment instead of dropping it
      FORCE_BODY: true,
      ADD_TAGS: ['use'],
      ALLOWED_URI_REGEXP: ALLOWED_URI_REGEXP,
      // a form on a card could post data elsewhere (frames and objects are already excluded by default)
      FORBID_TAGS: ['form'],
    });
  }

  /**
   * Sanitize a standalone SVG document (generated assets)
   */
  static sanitizeSvg(svg: string): string {
    if (!svg) {
      return '';
    }
    HtmlSanitizer.installHooks();
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
      ALLOWED_URI_REGEXP: ALLOWED_URI_REGEXP,
    });
  }
}
