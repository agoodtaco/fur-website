import { geometry } from './geometry-client.js';

export class BackendUnavailableError extends Error {
  constructor(cause) {
    super(
      'The geometry engine could not be loaded. If you are running this page ' +
      'as a static site, some features are unavailable. Run the project via ' +
      'Vite (`npm install && npm run dev`) to enable full processing. ' +
      `Underlying error: ${cause?.message ?? cause}`,
    );
    this.name = 'BackendUnavailableError';
    this.cause = cause;
  }
}

export async function processModel(fileBuffer, settings, onProgress = () => {}) {
  try {
    onProgress('repair', 0);
    const { mesh: repaired, report } = await geometry.repair(fileBuffer);
    onProgress('repair', 1, report);

    onProgress('shell', 0);
    const shelled = await geometry.hollow(repaired, settings.thickness);
    onProgress('shell', 1);

    onProgress('features', 0);
    const featured = await geometry.cutEyeMouth(shelled, {
      eyeDiameter: settings.eye / 1000,
      mouth: settings.mouth,
      eyePositions: settings.eyePositions,
      mouthCenter: settings.mouthCenter,
    });
    onProgress('features', 1);

    onProgress('vents', 0);
    const vented = settings.vents
      ? await geometry.addVents(featured, {
          density: settings.ventDensity / 100,
          holeDiameter: 0.012,
          exclusionZones: buildExclusionZones(settings),
        })
      : featured;
    onProgress('vents', 1);

    onProgress('validate', 0);
    const validation = await geometry.validate(vented, settings);
    onProgress('validate', 1, validation);

    return { mesh: vented, report, validation };
  } catch (err) {
    if (!geometry.available) throw new BackendUnavailableError(err);
    throw err;
  }
}

function buildExclusionZones(settings) {
  const zones = [];
  for (const eye of settings.eyePositions ?? []) {
    zones.push({ center: { x: eye.x, y: eye.y, z: eye.z }, radius: 0.09 });
  }
  if (settings.mouthCenter) {
    zones.push({ center: settings.mouthCenter, radius: 0.12 });
  }
  zones.push({ center: { x: 0, y: -0.2, z: 0 }, radius: 0.15 });
  return zones;
}

export async function exportModel(mesh) {
  const buffer = await geometry.exportSTL(mesh);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fursuit-base.stl';
  a.click();
  URL.revokeObjectURL(url);
}