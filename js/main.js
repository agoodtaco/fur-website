import { Viewer } from './viewer.js';
import { initUI } from './ui.js';
import { setState, state } from './state.js';

const viewer = new Viewer(document.getElementById('canvas-host'));
window.__viewer = viewer;

let lastMesh = null;

async function handleFile(file) {
  try {
    // Lazy-load the geometry backend only when a file is chosen.
    // If it fails, we catch it below and leave the UI intact.
    const { processModel, BackendUnavailableError } = await import('./pipeline.js');
    const buffer = await file.arrayBuffer();
    const { mesh } = await processModel(buffer, state.settings, (stage, pct, data) => {
      console.debug(`[pipeline] ${stage}: ${Math.round(pct * 100)}%`, data ?? '');
    });
    lastMesh = mesh;
    viewer.loadMeshData?.(mesh);
    setState({ modelLoaded: true, stage: 'validate' });
  } catch (err) {
    console.error(err);
    if (err?.name === 'BackendUnavailableError') {
      alert(err.message);
    } else {
      alert(`Could not process "${file.name}": ${err.message}`);
    }
  }
}

async function handleExport() {
  if (!lastMesh) return;
  try {
    const { exportModel } = await import('./pipeline.js');
    await exportModel(lastMesh);
  } catch (err) {
    console.error(err);
    alert(`Export failed: ${err.message}`);
  }
}

initUI({ viewer, onFile: handleFile, onExport: handleExport });