import { Injectable } from '@angular/core';
import * as htmlToImage from 'html-to-image';
import domToImageMore from 'dom-to-image-more';
import { LocalStorageService } from '../local-storage/local-storage.service';

export interface ImageRendererOptions {
    pixelRatio?: number;
    filter?: (node: HTMLElement) => boolean;
    onImageErrorHandler?: (error: unknown) => void;
    style?: Partial<CSSStyleDeclaration>;
}

@Injectable({
    providedIn: 'root'
})
export class ImageRendererService {

    constructor(private localStorageService: LocalStorageService) { }

    public toPng(node: HTMLElement, options?: ImageRendererOptions): Promise<string> {
        const renderer = this.localStorageService.getRenderer();

        if (renderer === 'dom-to-image-more') {
            // dom-to-image-more doesn't support pixelRatio as a direct option in the same way,
            // but it handles scaling differently.
            // Often strict pixelRatio support is limited or requires scaling the node manually.
            // Passing options through for now, might need adaptation.
            return domToImageMore.toPng(node, {
                filter: options?.filter,
                scale: options?.pixelRatio || 1,
                style: options?.style
            });
        } else {
            // Default to html-to-image
            return htmlToImage.toPng(node, options);
        }
    }

    /**
     * JPEG (data URL) of a node, on a white background: much smaller than a PNG for
     * illustrated cards, for print documents where transparency is not needed.
     */
    public toJpeg(node: HTMLElement, options?: ImageRendererOptions & { quality?: number }): Promise<string> {
        const quality = options?.quality ?? 0.92;
        if (this.localStorageService.getRenderer() === 'dom-to-image-more') {
            return domToImageMore.toJpeg(node, {
                filter: options?.filter,
                scale: options?.pixelRatio || 1,
                style: options?.style,
                quality,
                bgcolor: '#ffffff',
            });
        }
        return htmlToImage.toJpeg(node, { ...options, quality, backgroundColor: '#ffffff' });
    }
}
