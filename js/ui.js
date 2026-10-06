import { STAGES, PRESETS, state, setState, setSetting, subscribe } from './state.js';
import { computeEstimate, validate, MATERIAL_DENSITY } from './estimate.js';

export function initUI({ viewer, onFile, onExport }) {
  const el = {
    timeline: document.getElementById('timeline'),
    presets: document.getElementById('presets'),
    displayModes: document.getElementById('display-modes'),
    fileInput: document.getElementById('file-input'),
    exportBtn: document.getElementById('export-btn'),
    validateBtn: document.getElementById('validate-btn'),
    hint: document.getElementById('hint'),
    estimate: document.getElementById('estimate'),
    validation: document.getElementById('validation'),
    material: document.getElementById('material'),
    scale: document.getElementById('scale'),
    scaleOut: document.getElementById('scale-out'),
    thickness: document.getElementById('thickness'),
    thicknessOut: document.getElementById('thickness-out'),
    eye: document.getElementById('eye'),
    eyeOut: document.getElementById('eye-out'),
    mouth: document.getElementById('mouth'),
    vents: document.getElementById('vents'),
    ventDensity: document.getElementById('vent-density'),
    ventOut: document.getElementById('vent-out'),
    ventWarning: document.getElementById('vent-warning'),
    sectionField: document.getElementById('section-field'),
    sectionOffset: document.getElementById('section-offset'),
    sectionOut: document.getElementById('section-out'),
  };

  // --- Timeline ---
  el.timeline.innerHTML = '';
  for (const [i, stage] of STAGES.entries()) {
    const node = document.createElement('div');
    node.className = 'stage';
    node.dataset.stage = stage.id;
    node.innerHTML = `<span class="stage-index">${i + 1}</span><span>${stage.label}</span>`;
    node.addEventListener('click', () => setState({ stage: stage.id }));
    el.timeline.appendChild(node);
  }

  // --- Presets ---
  el.presets.innerHTML = '';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.textContent = key.charAt(0).toUpperCase() + key.slice(1);
    btn.addEventListener('click', () => {
      setState({ settings: { ...preset } });
      syncInputs(preset);
    });
    el.presets.appendChild(btn);
  }

  // --- Display modes ---
  el.displayModes.addEventListener('click', e => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    setState({ displayMode: btn.dataset.mode });
  });

  // --- Sliders ---
  const bindSlider = (input, out, key, format) => {
    input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      setSetting(key, value);
      out.textContent = format(value);
    });
  };
  bindSlider(el.scale, el.scaleOut, 'scale', v => `${v.toFixed(2)}×`);
  bindSlider(el.thickness, el.thicknessOut, 'thickness', v => `${Math.round(v * 1000)} mm`);
  bindSlider(el.eye, el.eyeOut, 'eye', v => `${Math.round(v)} mm`);

  // --- Bug 4 fix: gate vent density handler ---
  el.ventDensity.addEventListener('input', () => {
    if (!state.settings.vents) return;
    const v = parseFloat(el.ventDensity.value);
    setSetting('ventDensity', v);
    el.ventOut.textContent = `${Math.round(v)}%`;
  });

  el.mouth.addEventListener('change', () => setSetting('mouth', el.mouth.checked));
  el.vents.addEventListener('change', () => setSetting('vents', el.vents.checked));

  // --- Bug 6 fix: material selector ---
  el.material.innerHTML = Object.keys(MATERIAL_DENSITY)
    .map(m => `<option value="${m}">${m}</option>`)
    .join('');
  el.material.addEventListener('change', () => setSetting('material', el.material.value));

  // --- Bug 2 fix: section offset slider ---
  el.sectionOffset.addEventListener('input', () => {
    const t = parseFloat(el.sectionOffset.value);
    viewer.setSectionOffset(t);
    el.sectionOut.textContent = t.toFixed(2);
  });

  // --- File + export ---
  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    if (file) onFile(file);
  });
  el.exportBtn.addEventListener('click', onExport);

  // --- Manual re-run (still useful) ---
  el.validateBtn.addEventListener('click', () => {
    renderValidation(validate(viewer.getBoundingBox(), state.settings));
  });

  function syncInputs(s) {
    el.scale.value = s.scale;
    el.thickness.value = s.thickness;
    el.eye.value = s.eye;
    el.ventDensity.value = s.ventDensity;
    el.mouth.checked = s.mouth;
    el.vents.checked = s.vents;
    if (s.material) el.material.value = s.material;
    el.scaleOut.textContent = `${s.scale.toFixed(2)}×`;
    el.thicknessOut.textContent = `${Math.round(s.thickness * 1000)} mm`;
    el.eyeOut.textContent = `${Math.round(s.eye)} mm`;
    el.ventOut.textContent = `${Math.round(s.ventDensity)}%`;
  }

  function renderEstimate() {
    const box = viewer.getBoundingBox();
    const est = computeEstimate(box, state.settings);
    el.estimate.innerHTML = `
      <dt>Material</dt><dd>${est.material}</dd>
      <dt>Filament</dt><dd>${est.grams} g</dd>
      <dt>Print time</dt><dd>${est.time}</dd>
      <dt>Bounding box</dt><dd>${est.sizeMm}</dd>`;
  }

  // --- Bug 7 fix: no inline styles ---
  function renderValidation(results) {
    el.validation.innerHTML = results
      .map(r => `<li class="${r.status}">${r.label}<span class="note">${r.note}</span></li>`)
      .join('');
  }

  function renderTimeline() {
    const currentIdx = STAGES.findIndex(s => s.id === state.stage);
    el.timeline.querySelectorAll('.stage').forEach(node => {
      const id = node.dataset.stage;
      const idx = STAGES.findIndex(s => s.id === id);
      node.classList.toggle('active', id === state.stage);
      node.classList.toggle('done', idx < currentIdx);
    });
  }

  function renderDisplayModes() {
    el.displayModes.querySelectorAll('button[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.displayMode);
    });
    el.sectionField.classList.toggle('hidden', state.displayMode !== 'section');
  }

  function renderVentWarning() {
    el.ventWarning.classList.toggle('hidden', state.settings.vents);
    el.ventDensity.disabled = !state.settings.vents;
  }

  // --- React to state changes ---
  subscribe(s => {
    renderTimeline();
    renderDisplayModes();
    renderVentWarning();
    viewer.setDisplayMode(s.displayMode);
    el.exportBtn.disabled = !s.modelLoaded;
    el.hint.textContent = s.modelLoaded
      ? `Loaded · ${s.settings.vents ? 'ventilated' : 'solid'} · ${Math.round(s.settings.thickness * 1000)} mm shell`
      : 'No model loaded — showing preview head.';
    renderEstimate();
    // Bug 3 fix: validation stays in sync with state.
    renderValidation(validate(viewer.getBoundingBox(), s.settings));
  });

  syncInputs(state.settings);
}