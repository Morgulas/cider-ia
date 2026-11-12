import StringUtils from './string-utils';

describe('StringUtils file types', () => {
  it('gives the extension of the types a project holds', () => {
    expect(StringUtils.mimeToExtension('image/png')).toBe('png');
    expect(StringUtils.mimeToExtension('image/jpeg')).toBe('jpeg');
    expect(StringUtils.mimeToExtension('image/svg+xml')).toBe('svg');
    expect(StringUtils.mimeToExtension('text/markdown')).toBe('md');
    expect(StringUtils.mimeToExtension('text/css; charset=utf-8')).toBe('css');
    expect(StringUtils.mimeToExtension('font/woff2')).toBe('woff2');
    expect(StringUtils.mimeToExtension('application/x-unknown')).toBe('');
    expect(StringUtils.mimeToExtension('')).toBe('');
  });

  it('gives the type of a file from its extension', () => {
    expect(StringUtils.extensionToMime('PNG')).toBe('image/png');
    expect(StringUtils.extensionToMime('jpg')).toBe('image/jpeg');
    expect(StringUtils.extensionToMime('.webp')).toBe('image/webp');
    expect(StringUtils.extensionToMime('ttf')).toBe('font/ttf');
    expect(StringUtils.extensionToMime('md')).toBe('text/markdown');
    expect(StringUtils.extensionToMime('psd')).toBe('');
  });

  it('round-trips the extension of every known type', () => {
    for (const ext of ['png', 'jpeg', 'gif', 'webp', 'svg', 'ttf', 'otf', 'woff', 'woff2', 'md', 'css', 'html', 'json', 'pdf']) {
      expect(StringUtils.mimeToExtension(StringUtils.extensionToMime(ext))).toBe(ext);
    }
  });
});
