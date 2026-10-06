// Central app state with a tiny pub/sub so UI and viewer stay in sync.

export const STAGES = [
  { id: 'import',  label: 'Import' },
  { id: 'repair',  label: 'Repair' },
  { id: 'fit',     label: 'Fit' },
  { id: 'shell',   label: 'Shell' },
  { id: 'features',label: 'Features' },
  { id: 'vents',   label: 'Ventilation' },
  { id: 'validate',label: 'Validate' },
];

export const PRESETS = {
  toony:     { scale: 1.10, thickness: 0.015, eye: 80, mouth: true, vents: true,  ventDensity: 55, material: 'PLA'  },
  realistic: { scale: 1.00, thickness: 0.020, eye: 65, mouth: true, vents: true,  ventDensity: 45, material: 'PETG' },
  vented:    { scale: 1.05, thickness: 0.018, eye: 75, mouth: true, vents: true,  ventDensity: 90, material: 'PETG' },
  solid:     { scale: 1.00, thickness: 0.024, eye: 70, mouth: true, vents: false, ventDensity: 0,  material: 'ABS'  },
};

const listeners = new Set();

export const state = {
  stage: 'import',
  displayMode: 'solid',
  modelLoaded: false,
  settings: { ...PRESETS.realistic },
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach(fn => fn(state));
}

export function setSetting(key, value) {
  state.settings[key] = value;
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}