/**
 * File types of a card project (images, fonts, documents, sounds), by extension. Replaces the
 * full mime database (36 kB loaded at start-up) with the types a project actually holds; for
 * other files the browser's own type is used.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/vnd.microsoft.icon',
    tif: 'image/tiff', tiff: 'image/tiff',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', eot: 'application/vnd.ms-fontobject',
    md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', css: 'text/css', html: 'text/html', htm: 'text/html',
    csv: 'text/csv', json: 'application/json', js: 'text/javascript', xml: 'application/xml', pdf: 'application/pdf',
    zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm',
};
/** preferred extension of each type (the first one listed above, except these) */
const EXTENSION_BY_MIME: Record<string, string> = {
    ...Object.fromEntries(Object.entries(MIME_BY_EXTENSION).reverse().map(([ext, mime]) => [mime, ext])),
    'image/jpeg': 'jpeg', 'image/tiff': 'tif', 'text/markdown': 'md', 'text/html': 'html',
    'image/x-icon': 'ico', 'audio/mp3': 'mp3', 'audio/x-wav': 'wav', 'application/x-font-ttf': 'ttf',
};

export default class StringUtils {

    /**
     * Convert the provided string to kebab-case
     * 
     * @param input 
     * @returns 
     */
    public static toKebabCase(input: string): string {
        if (!input) {
            return input;
        }
        return ('' + input)
            .toLowerCase()
            .trim()
            .replace(/ /g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Convert the provided kebab-case string into title case
     * 
     * Ex. 'chicken-kebab' -> 'Chicken Kebab'
     * 
     * @param input 
     * @returns 
     */
    public static kebabToTitleCase(input: string): string {
        if (!input) {
            return input;
        }
        return input.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    /**
     * Split the file name and extension
     * 
     * @param filename 
     * @returns 
     */
    public static splitNameAndExtension(filename: string): { name: string; extension: string; } {
        if (!filename) {
            return { name: '', extension: '' };
        }
        const indexOfPeriod = filename.lastIndexOf('.');
        if (indexOfPeriod <= 0) {
            return { name: filename, extension: '' };
        }
        return {
            name: filename.substring(0, indexOfPeriod),
            extension: filename.substring(indexOfPeriod + 1)
        };
    }

    /**
     * Get the last directory from the given url string
     * 
     * @param url 
     * @ returns
     */
    public static lastDirectoryFromUrl(url: string) {
        const index = url.lastIndexOf('/') > 0 ? url.lastIndexOf('/') : url.lastIndexOf('\\');
        const name = url.substring(index + 1 | 0);
        return name;
    }

    /**
     * Get the directory from the given url string
     * 
     * @param url 
     * @returns 
     */
    public static getDirectoryFromUrl(url: string) {
        const index = url.lastIndexOf('/') > 0 ? url.lastIndexOf('/') : url.lastIndexOf('\\');
        if (index === -1) return '';
        return url.substring(0, index);
    }

    /**
     * Convert the given mime type into the relevant extension
     * 
     * @param mime 
     * @returns string
     */
    public static mimeToExtension(mime: string): string {
        if (!mime) {
            return '';
        }
        return EXTENSION_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? '';
    }

    /**
     * Convert the given file extension into the relevalt mime type
     * 
     * @param ext 
     * @returns 
     */
    public static extensionToMime(ext: string): string {
        if (!ext) {
            return '';
        }
        return MIME_BY_EXTENSION[ext.replace(/^\./, '').toLowerCase()] ?? '';
    }

    /**
     * Convert the given mime type into its type category
     * 
     * @param mime 
     * @returns 
     */
    public static mimeToTypeCategory(mime: string): string {
        if (!mime) {
            return '';
        }
        return mime.split('/')[0];
    }

    /**
     * Dedent multi-line strings to remove the leading tabs and first carriage return
     * 
     * @param input 
     */
    public static dedent(str: string): string {
        // Remove the first carriage return or newline
        str = str.replace(/^[ \t]*[\r\n]/, '');

        const lines = str.split('\n');

        // Filter out empty lines and get minimum indent
        const indents = lines
            .filter(line => line.trim().length > 0)
            .map(line => line.match(/^[ \t]*/)?.[0].length ?? 0);

        const minIndent = Math.min(...indents, Infinity);

        // Remove the minimum indent from all lines
        return lines
            .map(line => line.startsWith('\t') || line.startsWith(' ') ? line.slice(minIndent) : line)
            .join('\n');
    }

    /**
     * Generate a random string of the specified length
     * 
     * @param length 
     * @returns 
     */
    public static generateRandomString(length = 10): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    /**
     * Generate a random hex color
     * 
     * @returns 
     */
    public static generateRandomColor(): string {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }
}