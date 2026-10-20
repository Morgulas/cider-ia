import HtmlSanitizer from './html-sanitizer';

describe('HtmlSanitizer', () => {

  describe('sanitizeHtml', () => {
    it('returns an empty string for empty input', () => {
      expect(HtmlSanitizer.sanitizeHtml('')).toBe('');
    });

    it('removes scripts, event handlers and javascript: urls', () => {
      const out = HtmlSanitizer.sanitizeHtml(
        '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">l</a>');
      expect(out).not.toContain('<script');
      expect(out).not.toContain('onerror');
      expect(out).not.toContain('javascript:');
    });

    it('keeps the markup card designers rely on', () => {
      const out = HtmlSanitizer.sanitizeHtml(
        '<div class="title" style="color: blue" data-cost="3"><b>Apple</b><br><i>fruit</i></div>');
      expect(out).toContain('class="title"');
      expect(out).toContain('style="color: blue"');
      expect(out).toContain('data-cost="3"');
      expect(out).toContain('<b>Apple</b>');
    });

    it('keeps a style block, even at the start of the fragment', () => {
      const out = HtmlSanitizer.sanitizeHtml('<style>.a { color: red; }</style><div class="a">x</div>');
      expect(out).toContain('<style>.a { color: red; }</style>');
    });

    it('keeps blob: and data: images (project assets)', () => {
      const out = HtmlSanitizer.sanitizeHtml(
        '<img src="blob:http://localhost/1234"><img src="data:image/png;base64,AAAA">');
      expect(out).toContain('src="blob:http://localhost/1234"');
      expect(out).toContain('src="data:image/png;base64,AAAA"');
    });

    it('keeps inline svg with same-document <use> references only', () => {
      const out = HtmlSanitizer.sanitizeHtml(
        '<svg><symbol id="s"><circle r="1"></circle></symbol><use href="#s"></use><use href="https://evil.test/x.svg#a"></use></svg>');
      expect(out).toContain('<circle');
      expect(out).toContain('href="#s"');
      expect(out).not.toContain('evil.test');
    });

    it('removes forms', () => {
      const out = HtmlSanitizer.sanitizeHtml('<form action="https://evil.test"><input name="a"></form>');
      expect(out).not.toContain('<form');
    });
  });

  describe('sanitizeSvg', () => {
    it('keeps gradients and filters, removes event handlers', () => {
      const out = HtmlSanitizer.sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="f"><feTurbulence baseFrequency="0.1"></feTurbulence></filter>'
        + '<linearGradient id="g"><stop offset="0" stop-color="red"></stop></linearGradient></defs>'
        + '<rect width="10" height="10" fill="url(#g)" filter="url(#f)" onclick="alert(1)"></rect></svg>');
      expect(out).toContain('feTurbulence');
      expect(out).toContain('linearGradient');
      expect(out).toContain('fill="url(#g)"');
      expect(out).not.toContain('onclick');
    });

    it('removes scripts inside svg', () => {
      const out = HtmlSanitizer.sanitizeSvg('<svg><script>alert(1)</script><circle r="1"></circle></svg>');
      expect(out).not.toContain('<script');
      expect(out).toContain('<circle');
    });
  });
});
