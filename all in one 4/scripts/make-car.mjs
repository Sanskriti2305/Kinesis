// Generates public/models/car_assembly.obj — a low-poly car with named parts:
// exterior panels (thin, so the interior is visible with Section/Explode),
// interior, and mechanical components. Units: metres. Front = +X, up = +Y.
// Run: node scripts/make-car.mjs
import fs from 'node:fs';

const out = ['# Kinesis sample car assembly (procedural, low-poly)'];
let vOffset = 0;
const parts = [];

function begin(name) { parts.push({ name, v: [], f: [] }); }
function cur() { return parts[parts.length - 1]; }
function addV(x, y, z) { cur().v.push([x, y, z]); return cur().v.length; }

function box(cx, cy, cz, sx, sy, sz) {
  const [x0, x1, y0, y1, z0, z1] = [cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2];
  const base = cur().v.length;
  [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]].forEach((p) => addV(...p));
  const b = base;
  // quads, counter-clockwise seen from outside
  [[1,4,3,2],[5,6,7,8],[1,2,6,5],[4,8,7,3],[1,5,8,4],[2,3,7,6]].forEach((q) => cur().f.push(q.map((i) => b + i)));
}

function cyl(cx, cy, cz, r, len, axis, seg = 14) {
  const base = cur().v.length;
  const ring = (o) => {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
      if (axis === 'z') addV(cx + c, cy + s, cz + o);
      else if (axis === 'x') addV(cx + o, cy + c, cz + s);
      else addV(cx + c, cy + o, cz + s);
    }
  };
  ring(-len / 2); ring(len / 2);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    cur().f.push([base + i + 1, base + j + 1, base + seg + j + 1, base + seg + i + 1]);
  }
  const c0 = addV(...(axis === 'z' ? [cx, cy, cz - len / 2] : axis === 'x' ? [cx - len / 2, cy, cz] : [cx, cy - len / 2, cz]));
  const c1 = addV(...(axis === 'z' ? [cx, cy, cz + len / 2] : axis === 'x' ? [cx + len / 2, cy, cz] : [cx, cy + len / 2, cz]));
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    cur().f.push([c0, base + j + 1, base + i + 1]);
    cur().f.push([c1, base + seg + i + 1, base + seg + j + 1]);
  }
}

// ---- Exterior (thin panels) ----
begin('Chassis_Floor');   box(0, 0.30, 0, 4.0, 0.08, 1.7);
begin('Hood');            box(1.45, 0.92, 0, 1.3, 0.05, 1.7);
begin('Trunk_Lid');       box(-1.7, 0.92, 0, 0.8, 0.05, 1.7);
begin('Roof');            box(-0.2, 1.42, 0, 1.7, 0.05, 1.6);
begin('Windshield');      box(0.65, 1.17, 0, 0.05, 0.5, 1.5);
begin('Rear_Window');     box(-1.05, 1.17, 0, 0.05, 0.5, 1.5);
begin('Bumper_Front');    box(2.08, 0.5, 0, 0.15, 0.25, 1.8);
begin('Bumper_Rear');     box(-2.08, 0.5, 0, 0.15, 0.25, 1.8);
for (const [n, z] of [['L', 0.9], ['R', -0.9]]) {
  begin(`Fender_Front_${n}`);  box(1.4, 0.65, z, 1.2, 0.6, 0.05);
  begin(`Door_Front_${n}`);    box(0.35, 0.75, z, 0.9, 0.7, 0.05);
  begin(`Door_Rear_${n}`);     box(-0.55, 0.75, z, 0.9, 0.7, 0.05);
  begin(`Quarter_Panel_${n}`); box(-1.55, 0.65, z, 0.9, 0.6, 0.05);
  begin(`Headlight_${n}`);     box(2.0, 0.75, z * 0.66, 0.08, 0.12, 0.3);
  begin(`Taillight_${n}`);     box(-2.0, 0.75, z * 0.66, 0.08, 0.12, 0.3);
}
// ---- Wheels & axles ----
for (const [n, x, z] of [['FL', 1.3, 0.92], ['FR', 1.3, -0.92], ['RL', -1.3, 0.92], ['RR', -1.3, -0.92]]) {
  begin(`Wheel_${n}`); cyl(x, 0.33, z, 0.33, 0.22, 'z', 16);
}
begin('Axle_Front'); cyl(1.3, 0.33, 0, 0.04, 1.5, 'z', 8);
begin('Axle_Rear');  cyl(-1.3, 0.33, 0, 0.04, 1.5, 'z', 8);
// ---- Interior ----
begin('Dashboard');       box(0.85, 0.85, 0, 0.35, 0.25, 1.5);
begin('Steering_Wheel');  cyl(0.62, 0.97, 0.4, 0.18, 0.04, 'x', 16);
begin('Center_Console');  box(0.2, 0.5, 0, 0.8, 0.2, 0.25);
for (const [n, z] of [['Driver', 0.4], ['Passenger', -0.4]]) {
  begin(`Seat_${n}`); box(0.05, 0.5, z, 0.5, 0.15, 0.5); box(-0.2, 0.82, z, 0.1, 0.5, 0.5);
}
begin('Seat_Rear_Bench'); box(-0.85, 0.5, 0, 0.5, 0.15, 1.4); box(-1.1, 0.82, 0, 0.1, 0.5, 1.4);
// ---- Mechanical ----
begin('Engine_Block');  box(1.45, 0.55, 0, 0.7, 0.45, 0.7);
begin('Radiator');      box(1.93, 0.6, 0, 0.1, 0.4, 0.9);
begin('Battery');       box(1.7, 0.6, 0.55, 0.3, 0.2, 0.2);
begin('Gearbox');       box(0.85, 0.45, 0, 0.5, 0.3, 0.3);
begin('Drive_Shaft');   cyl(-0.1, 0.2, 0, 0.05, 1.9, 'x', 8);
begin('Exhaust');       cyl(-0.4, 0.22, -0.5, 0.04, 3.0, 'x', 8);
begin('Fuel_Tank');     box(-1.4, 0.42, 0, 0.8, 0.25, 1.0);

for (const p of parts) {
  out.push(`o ${p.name}`);
  for (const v of p.v) out.push(`v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}`);
  for (const f of p.f) out.push('f ' + f.map((i) => i + vOffset).join(' '));
  vOffset += p.v.length;
}
fs.writeFileSync(new URL('../public/models/car_assembly.obj', import.meta.url), out.join('\n') + '\n');
console.log(`wrote ${parts.length} parts`);
