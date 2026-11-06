import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BLOB_CONTENT_TYPE, PROJECT_CONTENT_TYPE, ProjectMeta, ProjectVersion } from './server.types';

/** The logged-in user's projects on the server */
@Injectable({ providedIn: 'root' })
export class ProjectsApiService {
  private readonly http = inject(HttpClient);

  async list(): Promise<ProjectMeta[]> {
    return (await firstValueFrom(this.http.get<{ projects: ProjectMeta[] }>('/api/projects'))).projects;
  }

  async get(id: string): Promise<ProjectMeta> {
    return (await firstValueFrom(this.http.get<{ project: ProjectMeta }>(`/api/projects/${id}`))).project;
  }

  async create(name: string): Promise<ProjectMeta> {
    return (await firstValueFrom(this.http.post<{ project: ProjectMeta }>('/api/projects', { name }))).project;
  }

  async rename(id: string, name: string): Promise<ProjectMeta> {
    return (await firstValueFrom(this.http.patch<{ project: ProjectMeta }>(`/api/projects/${id}`, { name }))).project;
  }

  delete(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/projects/${id}`));
  }

  /** Project data and its revision; data is null for a project never saved */
  async loadData(id: string): Promise<{ data: Blob | null; revision: number }> {
    const response = await firstValueFrom(this.http.get(`/api/projects/${id}/data`,
      { observe: 'response', responseType: 'blob' }));
    const revision = Number(response.headers.get('x-project-revision') ?? 0);
    return { data: response.status === 204 ? null : response.body, revision };
  }

  /**
   * Saves the project data. baseRevision is the revision this copy started from;
   * the server answers 409 if a newer one was saved elsewhere, unless force is set.
   */
  async saveData(id: string, data: Blob, baseRevision: number, force = false,
    change?: { label: string; important: boolean }): Promise<ProjectMeta> {
    let headers = new HttpHeaders({ 'Content-Type': PROJECT_CONTENT_TYPE, 'X-Base-Revision': String(baseRevision) });
    if (change?.label) {
      // described in the version history (encoded: headers are ASCII)
      headers = headers.set('X-Cider-Change', encodeURIComponent(change.label.slice(0, 300)));
    }
    if (change?.important) {
      headers = headers.set('X-Cider-Change-Important', '1');
    }
    const url = `/api/projects/${id}/data${force ? '?force=1' : ''}`;
    return (await firstValueFrom(this.http.put<{ project: ProjectMeta }>(url, data, { headers }))).project;
  }

  /** The project as a complete export, files included (download) */
  async exportData(id: string): Promise<Blob | null> {
    const response = await firstValueFrom(this.http.get(`/api/projects/${id}/export`,
      { observe: 'response', responseType: 'blob' }));
    return response.status === 204 ? null : response.body;
  }

  /** Which of these project files the server does not have yet */
  async missingBlobs(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) {
      return [];
    }
    return (await firstValueFrom(this.http.post<{ missing: string[] }>('/api/blobs/missing', { hashes }))).missing;
  }

  /** Sends a project file, identified by the SHA-256 of its content */
  async uploadBlob(hash: string, blob: Blob): Promise<void> {
    await firstValueFrom(this.http.put(`/api/blobs/${hash}`, blob,
      { headers: new HttpHeaders({ 'Content-Type': BLOB_CONTENT_TYPE }) }));
  }

  /** A project file (kept in the browser cache: its content never changes) */
  blob(hash: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`/api/blobs/${hash}`, { responseType: 'blob' }));
  }

  /** Kept versions of a project, newest first */
  async versions(id: string): Promise<ProjectVersion[]> {
    return (await firstValueFrom(this.http.get<{ versions: ProjectVersion[] }>(`/api/projects/${id}/versions`))).versions;
  }

  versionData(id: string, revision: number): Promise<Blob> {
    return firstValueFrom(this.http.get(`/api/projects/${id}/versions/${revision}`, { responseType: 'blob' }));
  }

  /** Restores a version as the current state of the project, or as a new project (asNew + name) */
  async restoreVersion(id: string, revision: number, asNew = false, name = ''): Promise<ProjectMeta> {
    return (await firstValueFrom(this.http.post<{ project: ProjectMeta }>(
      `/api/projects/${id}/versions/${revision}/restore`, { asNew, name }))).project;
  }
}
