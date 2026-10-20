/**
 * Loads a script from this site once, on demand (e.g. Mermaid for markdown documents),
 * instead of shipping it in the initial bundle.
 */
export default class ScriptLoader {
  private static loading = new Map<string, Promise<void>>();

  static load(src: string): Promise<void> {
    let promise = ScriptLoader.loading.get(src);
    if (!promise) {
      promise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          ScriptLoader.loading.delete(src);
          script.remove();
          reject(new Error(`Could not load script ${src}`));
        };
        document.head.appendChild(script);
      });
      ScriptLoader.loading.set(src, promise);
    }
    return promise;
  }
}
