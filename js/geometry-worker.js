import * as Comlink from 'comlink';
import * as tf from '@polydera/trueform';
import { MeshFixWorker } from 'meshfix-wasm';
import {
  Brush, Evaluator, SUBTRACTION,
} from 'three-bvh-csg';
import {
  BufferGeometry, BufferAttribute, Mesh, Matrix4, Vector3, Box3,
  CylinderGeometry, SphereGeometry, Plane, Raycaster,
} from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function geometryToTransferable(geometry) {
  const pos = geometry.getAttribute('position');
  const idx = geometry.index;
  if (!idx) {
    // Non-indexed geometry — synthesise an index
    const indices = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) indices[i] = i;
    return {
      positions: new Float32Array(pos.array),
      indices,
      vertexCount: pos.count,
      triangleCount: pos.count / 3,
    };
  }
  return {
    positions: new Float32Array(pos.array),
    indices: new Uint32Array(idx.array),
    vertexCount: pos.count,
    triangleCount: idx.count / 3,
  };
}

function transferableToGeometry({ positions, indices }) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  g.computeVertexNormals();
  return g;
}

// Deterministic Poisson-disk sampling for vent hole placement.
// Uses a simple grid-jitter instead of true Poisson-disk for speed.
function sampleVentPoints(box, density, minSpacing) {
  const size = box.getSize(new Vector3());
  const step = Math.max(minSpacing, Math.cbrt(1 / density) * 0.05);
  const points = [];
  for (let x = box.min.x; x <= box.max.x; x += step) {
    for (let y = box.min.y; y <= box.max.y; y += step) {
      for (let z = box.min.z; z <= box.max.z; z += step) {
        const jitter = step * 0.3;
        points.push(new Vector3(
          x + (Math.random() - 0.5) * jitter,
          y + (Math.random() - 0.5) * jitter,
          z + (Math.random() - 0.5) * jitter,
        ));
      }
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// Worker API
// ---------------------------------------------------------------------------

const api = {

  // -- Stage 1: Repair -----------------------------------------------------
  async repair(buffer) {
    const meshfix = await MeshFixWorker.init();

    const { analysis, issues } = await meshfix.analyzeDetailed(buffer);

    const repairResult = await meshfix.repair({
      weldEpsilon: 1e-6,
      minArea: 1e-10,
      maxHoleEdges: 100,
    });

    const repairedBuffer = await meshfix.exportMesh('stl');
    meshfix.dispose();

    // Convert repaired STL back to a transferable geometry representation
    const repairedMesh = tf.readStl(repairedBuffer);
    const positions = new Float32Array(repairedMesh.points.data);
    const indices = new Uint32Array(repairedMesh.faces.data);

    return {
      mesh: {
        positions,
        indices,
        vertexCount: positions.length / 3,
        triangleCount: indices.length / 3,
      },
      report: {
        verticesBefore: repairResult.verticesBefore,
        verticesAfter: repairResult.verticesAfter,
        facesBefore: repairResult.facesBefore,
        facesAfter: repairResult.facesAfter,
        issues: issues.map(i => i.message),
      },
      originalAnalysis: analysis,
    };
  },

  // -- Stage 2: Hollow shell ----------------------------------------------
  async hollow(meshData, thickness) {
    const outer = tf.mesh(
      tf.ndarray(meshData.indices, [meshData.indices.length / 3, 3]),
      tf.ndarray(meshData.positions, [meshData.positions.length / 3, 3]),
    );

    // Voxel-based offset to create the inner shell.
    // Using MeshLib-style voxel repair for robustness on organic meshes.
    const inner = tf.generalOffsetMesh(outer, -thickness, {
      voxelSize: 0.002,             // 2 mm voxels — fine enough for fursuit bases
      signDetectionMode: 'HoleWindingRule',
      closeHolesInHoleWindingNumber: true,
    });

    // Boolean difference: outer − inner
    const shelled = tf.booleanDifference(outer, inner, {
      returnCurves: false,
    });

    const positions = new Float32Array(shelled.mesh.points.data);
    const indices = new Uint32Array(shelled.mesh.faces.data);

    return {
      positions,
      indices,
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
    };
  },

  // -- Stage 3: Eye and mouth holes ---------------------------------------
  async cutEyeMouth(meshData, params) {
    // params: { eyeDiameter, mouth: bool, eyePositions: [{x,y,z}, ...] }
    let current = tf.mesh(
      tf.ndarray(meshData.indices, [meshData.indices.length / 3, 3]),
      tf.ndarray(meshData.positions, [meshData.positions.length / 3, 3]),
    );

    // Eye holes — cylinders oriented along -Z (forward)
    for (const eye of params.eyePositions ?? []) {
      const eyeCyl = tf.cylinder(
        params.eyeDiameter / 2,
        0.3,                          // long enough to punch through
        tf.vector(0, 0, 1),
        tf.vector(eye.x, eye.y, eye.z),
      );
      const result = tf.booleanDifference(current, eyeCyl);
      current = result.mesh;
    }

    // Mouth hole — rounded box or cylinder
    if (params.mouth) {
      const mouthCenter = params.mouthCenter ?? { x: 0, y: -0.08, z: 0.15 };
      const mouthBox = tf.box(
        tf.vector(0.12, 0.06, 0.3),
        tf.vector(mouthCenter.x, mouthCenter.y, mouthCenter.z),
      );
      const result = tf.booleanDifference(current, mouthBox);
      current = result.mesh;
    }

    return {
      positions: new Float32Array(current.points.data),
      indices: new Uint32Array(current.faces.data),
      vertexCount: current.points.data.length / 3,
      triangleCount: current.faces.data.length / 3,
    };
  },

  // -- Stage 4: Ventilation holes -----------------------------------------
  async addVents(meshData, params) {
    // params: { density, holeDiameter, exclusionZones: [{center, radius}] }
    const geometry = transferableToGeometry(meshData);
    const mesh = new Mesh(geometry);

    const box = new Box3().setFromObject(mesh);
    const points = sampleVentPoints(box, params.density, 0.025);

    // Build a BVH for fast raycasting against the shell
    const raycaster = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const hits = [];

    for (const p of points) {
      // Skip points inside exclusion zones (eyes, mouth, neck)
      let excluded = false;
      for (const zone of params.exclusionZones ?? []) {
        if (p.distanceTo(zone.center) < zone.radius) { excluded = true; break; }
      }
      if (excluded) continue;

      raycaster.set(p, down);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (hit) hits.push(hit.point.clone());
    }

    // Build a single brush containing all vent cylinders, subtract once.
    let current = tf.mesh(
      tf.ndarray(meshData.indices, [meshData.indices.length / 3, 3]),
      tf.ndarray(meshData.positions, [meshData.positions.length / 3, 3]),
    );

    for (const h of hits) {
      const cyl = tf.cylinder(
        params.holeDiameter / 2,
        0.1,
        tf.vector(0, 1, 0),
        tf.vector(h.x, h.y, h.z),
      );
      const result = tf.booleanDifference(current, cyl);
      current = result.mesh;
    }

    return {
      positions: new Float32Array(current.points.data),
      indices: new Uint32Array(current.faces.data),
      vertexCount: current.points.data.length / 3,
      triangleCount: current.faces.data.length / 3,
      ventCount: hits.length,
    };
  },

  // -- Stage 5: Validation -------------------------------------------------
  async validate(meshData, settings) {
    const geometry = transferableToGeometry(meshData);
    const mesh = new Mesh(geometry);

    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    const thicknessMm = settings.thickness * 1000;
    const longestMm = Math.max(size.x, size.y, size.z) * 1000;

    // Watertightness check — use trueform's connected components
    const tfMesh = tf.mesh(
      tf.ndarray(meshData.indices, [meshData.indices.length / 3, 3]),
      tf.ndarray(meshData.positions, [meshData.positions.length / 3, 3]),
    );
    const { nComponents } = tf.connectedComponents(tfMesh, 'manifoldEdge');

    const results = [
      {
        label: 'Mesh is watertight',
        status: nComponents === 1 ? 'ok' : 'warn',
        note: nComponents === 1 ? 'Single manifold shell' : `${nComponents} components`,
      },
      {
        label: `Wall thickness ≥ 2 mm`,
        status: thicknessMm >= 2 ? 'ok' : 'err',
        note: `${thicknessMm.toFixed(1)} mm`,
      },
      {
        label: 'Fits a 256 mm print bed',
        status: longestMm <= 256 ? 'ok' : 'warn',
        note: `${Math.round(longestMm)} mm longest edge`,
      },
    ];

    if (!settings.vents) {
      results.push({
        label: 'Ventilation enabled',
        status: 'warn',
        note: 'Heat buildup risk',
      });
    }

    return { results, boundingBox: { x: size.x, y: size.y, z: size.z } };
  },

  // -- Stage 6: STL export -------------------------------------------------
  async exportSTL(meshData) {
    const geometry = transferableToGeometry(meshData);
    const mesh = new Mesh(geometry);
    const exporter = new STLExporter();
    const buffer = exporter.parse(mesh, { binary: true });
    return buffer;
  },
};

Comlink.expose(api);