import * as THREE from 'three';

const MATERIAL_DENSITY = {      // g/cm³
  PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07,
};

const PRINTERS = {
  'ender-3':   { x: 220, y: 220, label: 'Ender-3 (220×220)' },
  'prusa-mk4': { x: 250, y: 210, label: 'Prusa MK4 (250×210)' },
  'bambu-p1s': { x: 256, y: 256, label: 'Bambu P1S (256×256)' },
};

export function computeEstimate(box, settings) {
  const size = box.getSize(new THREE.Vector3());          // metres
  const bboxVol = size.x * size.y * size.z * 1e6;          // cm³
  const shellFrac = 0.10;
  const material = settings.material ?? 'PETG';

  const ventFactor = settings.vents ? 1 - settings.ventDensity / 100 * 0.35 : 1;
  const shellVol = bboxVol * shellFrac * ventFactor;
  const grams = shellVol * (MATERIAL_DENSITY[material] ?? MATERIAL_DENSITY.PETG);

  const minutes = grams * 3.1;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  return {
    material,
    grams: Math.round(grams),
    time: `${hours}h ${mins}m`,
    sizeMm: `${Math.round(size.x * 1000)} × ${Math.round(size.y * 1000)} × ${Math.round(size.z * 1000)} mm`,
  };
}

export function validate(box, settings, printer = 'prusa-mk4') {
  const size = box.getSize(new THREE.Vector3());
  const thicknessMm = settings.thickness * 1000;

  const bed = PRINTERS[printer] ?? PRINTERS['prusa-mk4'];
  const w = size.x * 1000;
  const d = size.z * 1000;
  const fits = (w <= bed.x && d <= bed.y) || (w <= bed.y && d <= bed.x);

  const results = [
    { label: 'Mesh is watertight', status: 'warn', note: 'Requires geometry worker' },
    { label: 'No self-intersections', status: 'warn', note: 'Requires geometry worker' },
    {
      label: 'Wall thickness ≥ 2 mm',
      status: thicknessMm >= 2 ? 'ok' : 'err',
      note: `${thicknessMm.toFixed(1)} mm`,
    },
    {
      label: `Fits ${bed.label}`,
      status: fits ? 'ok' : 'warn',
      note: `${Math.round(w)} × ${Math.round(d)} mm footprint`,
    },
    { label: 'Overhangs under 45°', status: 'warn', note: 'Requires geometry worker' },
  ];

  if (!settings.vents) {
    results.push({ label: 'Ventilation enabled', status: 'warn', note: 'Heat buildup risk' });
  }

  return results;
}

export { MATERIAL_DENSITY, PRINTERS };