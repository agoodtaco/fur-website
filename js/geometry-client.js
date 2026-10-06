class GeometryClient {
  constructor() {
    this.worker = null;
    this.api = null;
    this.busy = false;
    this._loadPromise = null;
  }

  async _ensureLoaded() {
    if (this.api) return;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      // Dynamic imports so a missing dependency only breaks the backend,
      // not the whole page.
      const Comlink = await import('comlink');

      // Worker URL: works under Vite (import.meta.url is a real URL),
      // and under static hosting as long as the file is at a known path.
      const workerUrl = new URL('./geometry-worker.js', import.meta.url);
      const worker = new Worker(workerUrl, { type: 'module' });

      // Surface worker load failures as rejections instead of silent hangs.
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Geometry worker failed to load within 15 s. Check the console for the underlying import error.')),
          15000,
        );
        worker.addEventListener('message', function onFirst(e) {
          // Any message from the worker means it loaded and ran.
          clearTimeout(timeout);
          worker.removeEventListener('message', onFirst);
          resolve();
        });
        worker.addEventListener('error', e => {
          clearTimeout(timeout);
          reject(new Error(`Geometry worker error: ${e.message || 'unknown'}`));
        });
      });

      this.worker = worker;
      this.api = Comlink.wrap(worker);
    })();

    return this._loadPromise;
  }

  async _run(method, ...args) {
    await this._ensureLoaded();
    if (this.busy) throw new Error('Geometry worker is busy');
    this.busy = true;
    try {
      return await this.api[method](...args);
    } finally {
      this.busy = false;
    }
  }

  repair(buffer)              { return this._run('repair', buffer); }
  hollow(mesh, thickness)     { return this._run('hollow', mesh, thickness); }
  cutEyeMouth(mesh, params)   { return this._run('cutEyeMouth', mesh, params); }
  addVents(mesh, params)      { return this._run('addVents', mesh, params); }
  validate(mesh, settings)    { return this._run('validate', mesh, settings); }
  exportSTL(mesh)             { return this._run('exportSTL', mesh); }

  get available() {
    return !!this.api;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.api = null;
  }
}

export const geometry = new GeometryClient();