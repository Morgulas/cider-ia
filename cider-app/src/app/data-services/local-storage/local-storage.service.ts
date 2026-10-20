import { Injectable } from '@angular/core';

export interface ExportConfiguration {
  exportType?: string;
  paperType?: string;
  paperConfig?: {
    width: number;
    height: number;
    width_custom: number;
    height_custom: number;
    orientation: 'landscape' | 'portrait';
    mirrorBacksX: boolean;
    mirrorBacksY: boolean;
    cardsPerPage: number;
    cardGap: number;
    paperMarginX: number;
    paperMarginY: number;
    paperDpi: number;
  },
  lowInk?: boolean;
  excludeCardBacks?: boolean;
  showCutMarks?: boolean;
  cutBleed?: number;
  cutMarkLength?: number;
  individualExportPixelRatio?: number;
  individualExportUseCardName?: boolean;
  scale?: number;
  maxTtsPixels?: number;
  softProofMode?: string;
  softProofIntent?: number;
  softProofEnabled?: boolean;
  simulateUnsharpMask?: boolean;
}

export interface PreviewSettings {
  tiltEnabled: boolean;
  trimLinesEnabled: boolean;
  trimOffset: number;
  trimUnit: 'in' | 'px' | 'mm';
  safeLinesEnabled: boolean;
  safeOffset: number;
  safeUnit: 'in' | 'px' | 'mm';
}

/**
 * Local storage is used for storing user preferences
 */
@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {
  static readonly DARK_MODE = "dark-mode";
  static readonly RENDERER_TYPE = "renderer-type";
  static readonly EXPORT_CONFIG = "export-config";
  static readonly PREVIEW_SETTINGS = "preview-settings";

  public getLanguage(): string | null {
    return localStorage.getItem('language');
  }

  public setLanguage(lang: string) {
    localStorage.setItem('language', lang);
  }

  public getDarkMode(): boolean {
    const darkMode = localStorage.getItem(LocalStorageService.DARK_MODE);
    return darkMode === 'true' || darkMode === null; // Default to true if not set
  }

  public setDarkMode(darkMode: boolean) {
    localStorage.setItem(LocalStorageService.DARK_MODE, darkMode.toString());
  }

  public getRenderer(): string {
    return localStorage.getItem(LocalStorageService.RENDERER_TYPE) || 'html-to-image';
  }

  public setRenderer(renderer: string) {
    localStorage.setItem(LocalStorageService.RENDERER_TYPE, renderer);
  }

  public getExportConfig(): ExportConfiguration | null {
    const config = localStorage.getItem(LocalStorageService.EXPORT_CONFIG);
    return config ? JSON.parse(config) : null;
  }

  public setExportConfig(config: ExportConfiguration) {
    localStorage.setItem(LocalStorageService.EXPORT_CONFIG, JSON.stringify(config));
  }

  public getPreviewSettings(): PreviewSettings | null {
    const settings = localStorage.getItem(LocalStorageService.PREVIEW_SETTINGS);
    return settings ? JSON.parse(settings) : null;
  }

  public setPreviewSettings(settings: PreviewSettings) {
    localStorage.setItem(LocalStorageService.PREVIEW_SETTINGS, JSON.stringify(settings));
  }

}
