// Whip-app: tray-bubble with a verlet-rope whip that cracks when its tip
// strikes the centered character. Keep deps zero; everything runs on Canvas2D
// + WebAudio so the bundle stays light.

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  // Use ceil for the backing store so it always covers the CSS area —
  // a floor-truncated backing leaves a 1px strip at the right/bottom
  // that clearRect never touches, which builds up whip trails.
  canvas.width = Math.ceil(rect.width * dpr);
  canvas.height = Math.ceil(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener("resize", fitCanvas);

// -------- whip (verlet rope) ----------------------------------------------
const SEGMENT_COUNT = 24;       // total nodes including the handle
const HANDLE_NODES = 7;         // first N nodes form the rigid stick handle
const SEGMENT_LEN = 7;          // distance constraint between nodes (px)
const HANDLE_WIDTH = 13;        // visual stick thickness (px)
const ITER = 20;                // constraint solver passes per frame
const GRAVITY = 0.35;
const DAMPING = 0.985;

type RopeNode = { x: number; y: number; px: number; py: number };
const nodes: RopeNode[] = [];

function initWhip(x: number, y: number) {
  nodes.length = 0;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    nodes.push({ x: x + i * SEGMENT_LEN, y, px: x + i * SEGMENT_LEN, py: y });
  }
}

// Direction the handle points (butt → joint) at rest, in degrees clockwise
// from +x. 255° = up-and-left, so the butt sits down-and-right of the
// joint (= cursor) and the lash extends up-and-left from the joint via
// the follow-handle constraint.
const HANDLE_ANGLE_DEG = 255;
const HANDLE_ANGLE = (HANDLE_ANGLE_DEG * Math.PI) / 180;
// Minimum cursor displacement from the click anchor before we update the
// butt direction. Keeps the handle from snapping when the user just
// clicks without moving (cursor == anchor → direction is undefined).
const MIN_DRAG = 4;
// Bend-stiffness: each interior lash node is pulled toward the midpoint of
// its neighbors. Provides general straightening; follow-handle (below)
// owns the directional alignment with the stick.
const BEND_NEAR_HANDLE = 0.35;
// Follow-handle strength per lash node, smoothly decaying. Each node is
// pulled onto the line extending out from the handle in the stick's
// direction. Long, smooth taper so there's no abrupt "no-force" zone
// after the rigid section — closer to the handle = closer to handle's
// rigidity, blending into floppy tail by the end of the array.
const FOLLOW_K = [
  0.16, 0.13, 0.1, 0.08, 0.063, 0.05, 0.04, 0.032, 0.025, 0.019, 0.014, 0.01,
  0.007, 0.004,
];
// Physical handle length from butt to lash joint.
const HANDLE_LEN = (HANDLE_NODES - 1) * SEGMENT_LEN;
// While gripping, the joint is spring-pulled toward the anchor each
// frame. Smaller k = heavier feel (joint drifts slowly back to anchor
// instead of snapping). 0.15 ≈ heavy mass with light give.
const GRIP_ANCHOR_K = 0.15;

// Butt direction (from joint outward to butt) while gripping. Kept as
// state across frames so a click without movement keeps the last good
// direction instead of collapsing the handle to a single point.
let gripDirX = -Math.cos(HANDLE_ANGLE);
let gripDirY = -Math.sin(HANDLE_ANGLE);

// Resolve where the butt and joint (handle's lash-side end) should be
// this frame, based on gripping state. The handle is treated as a
// perfectly rigid rod between these two points — no verlet flexing.
function resolveHandleEndpoints(
  cursorX: number,
  cursorY: number,
  gripping: boolean,
  anchorX: number,
  anchorY: number
): { buttX: number; buttY: number; tipX: number; tipY: number } {
  if (gripping) {
    // The joint (handle's lash-side end, where the cursor "sits") gets
    // spring-pulled toward the click anchor each frame. Low k makes it
    // feel heavy — it doesn't snap, just slowly relaxes back to anchor.
    const joint = nodes[HANDLE_NODES - 1];
    const tipX = joint.x + (anchorX - joint.x) * GRIP_ANCHOR_K;
    const tipY = joint.y + (anchorY - joint.y) * GRIP_ANCHOR_K;

    // Compass: cursor's offset from anchor sets the butt's angular
    // position around the joint. The butt sits on the OPPOSITE side of
    // the joint from the cursor — your hand pulls back while you aim
    // the lash toward where the cursor is pointing. When the cursor is
    // sitting on the anchor (just clicked, no drag yet), gripDir keeps
    // its previous value so the handle never collapses to a point.
    const dx = cursorX - anchorX;
    const dy = cursorY - anchorY;
    const mag = Math.hypot(dx, dy);
    if (mag > MIN_DRAG) {
      gripDirX = -dx / mag;
      gripDirY = -dy / mag;
    }
    const buttX = tipX + gripDirX * HANDLE_LEN;
    const buttY = tipY + gripDirY * HANDLE_LEN;
    return { buttX, buttY, tipX, tipY };
  }

  // Free mode: cursor IS the joint, and the butt sits up-and-left of it
  // at the resting handle angle. Moving the cursor translates the whole
  // whip rigidly — handle angle stays fixed in world space.
  const tipX = cursorX;
  const tipY = cursorY;
  const buttX = cursorX - Math.cos(HANDLE_ANGLE) * HANDLE_LEN;
  const buttY = cursorY - Math.sin(HANDLE_ANGLE) * HANDLE_LEN;
  return { buttX, buttY, tipX, tipY };
}

function stepWhip(
  cursorX: number,
  cursorY: number,
  gripping: boolean,
  anchorX: number,
  anchorY: number
) {
  // Integrate only the LASH (handle is set rigidly each frame).
  for (let i = HANDLE_NODES; i < nodes.length; i++) {
    const n = nodes[i];
    const vx = (n.x - n.px) * DAMPING;
    const vy = (n.y - n.py) * DAMPING;
    n.px = n.x;
    n.py = n.y;
    n.x += vx;
    n.y += vy + GRAVITY;
  }

  // Place the handle as a perfectly straight rod between butt and tip.
  // nodes[HANDLE_NODES-1] is the lash joint that the lash hangs off.
  const { buttX, buttY, tipX, tipY } = resolveHandleEndpoints(
    cursorX,
    cursorY,
    gripping,
    anchorX,
    anchorY
  );
  for (let i = 0; i < HANDLE_NODES; i++) {
    const t = i / (HANDLE_NODES - 1);
    const x = buttX + (tipX - buttX) * t;
    const y = buttY + (tipY - buttY) * t;
    nodes[i].px = nodes[i].x; // record the previous frame's pos so the
    nodes[i].py = nodes[i].y; // lash joint's motion transfers as velocity
    nodes[i].x = x;            // through the first lash distance constraint
    nodes[i].y = y;
  }

  // Direction the handle currently points (butt -> tip), normalized. Each
  // lash node in the follow-region gets pulled onto this extended line so
  // the lash starts aligned with the stick and tapers off smoothly.
  const dirX = (tipX - buttX) / HANDLE_LEN;
  const dirY = (tipY - buttY) / HANDLE_LEN;

  // Lash-only constraint pass. The lash hangs from the now-rigid handle tip;
  // its motion comes purely from how the tip moves frame-to-frame, gravity,
  // and the cascading rope corrections. The cursor never pulls it directly.
  const lashFirst = HANDLE_NODES;
  const lashSpan = nodes.length - lashFirst - 1;
  for (let iter = 0; iter < ITER; iter++) {
    // Follow-handle: pull the first few lash nodes onto the line extending
    // out from the handle tip. This is what makes the lash start in the
    // handle's direction instead of dangling straight down from the joint.
    for (let j = 0; j < FOLLOW_K.length; j++) {
      const i = lashFirst + j;
      if (i >= nodes.length) break;
      const step = j + 1;
      const tgtX = tipX + dirX * SEGMENT_LEN * step;
      const tgtY = tipY + dirY * SEGMENT_LEN * step;
      const k = FOLLOW_K[j];
      nodes[i].x += (tgtX - nodes[i].x) * k;
      nodes[i].y += (tgtY - nodes[i].y) * k;
    }

    for (let i = lashFirst; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const cur = nodes[i];
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const dist = Math.hypot(dx, dy) || 1;
      const diff = (dist - SEGMENT_LEN) / dist;
      // The handle tip (prev when i === lashFirst) is a hard anchor —
      // only the lash side gets corrected. Subsequent lash links share.
      if (i === lashFirst) {
        cur.x -= dx * diff;
        cur.y -= dy * diff;
      } else {
        const halfX = dx * 0.5 * diff;
        const halfY = dy * 0.5 * diff;
        prev.x += halfX;
        prev.y += halfY;
        cur.x -= halfX;
        cur.y -= halfY;
      }
    }

    // Bend constraint: pull each interior lash node toward the midpoint
    // of its neighbors. Strength tapers from BEND_NEAR_HANDLE at the
    // first lash node down to 0 at the tip — stiffer near the handle,
    // floppy at the tip. The handle joint itself is the rigid anchor.
    for (let i = lashFirst; i < nodes.length - 1; i++) {
      const t = lashSpan > 0 ? (i - lashFirst) / lashSpan : 1;
      const k = BEND_NEAR_HANDLE * (1 - t);
      if (k <= 0) continue;
      const a = nodes[i - 1];
      const b = nodes[i];
      const c = nodes[i + 1];
      const mx = (a.x + c.x) * 0.5;
      const my = (a.y + c.y) * 0.5;
      b.x += (mx - b.x) * k;
      b.y += (my - b.y) * k;
    }
  }
}

function drawWhip() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Lash first so the handle covers the joint cleanly.
  for (let i = HANDLE_NODES - 1; i < nodes.length - 1; i++) {
    const t = (i - (HANDLE_NODES - 1)) / (nodes.length - HANDLE_NODES);
    const width = 5 * (1 - t) + 1.2 * t;
    ctx.strokeStyle = t < 0.7 ? "#2b2117" : "#1a130d";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[i + 1].x, nodes[i + 1].y);
    ctx.stroke();
  }

  // Tip popper.
  const tip = nodes[nodes.length - 1];
  ctx.fillStyle = "#0e0a06";
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Handle drawn as a single rigid rod from the butt to the lash joint.
  // The handle nodes are stiff-constrained so this stays straight.
  const a = nodes[0];
  const b = nodes[HANDLE_NODES - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const w = HANDLE_WIDTH;

  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(angle);

  // Stick body — rounded rectangle along +x.
  ctx.fillStyle = "#6b3a1f";
  ctx.strokeStyle = "#2a1608";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-w * 0.4, -w / 2, len + w * 0.4, w, w / 2);
  ctx.fill();
  ctx.stroke();

  // Pommel cap at the butt.
  ctx.fillStyle = "#2a1608";
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // Grip ridges along the stick — subtle horizontal lines.
  ctx.strokeStyle = "#3a1f10";
  ctx.lineWidth = 1;
  const ridges = 4;
  for (let i = 1; i <= ridges; i++) {
    const x = (len * i) / (ridges + 1);
    ctx.beginPath();
    ctx.moveTo(x, -w / 2 + 1);
    ctx.lineTo(x, w / 2 - 1);
    ctx.stroke();
  }

  ctx.restore();
}

// -------- character -------------------------------------------------------
import characterUrl from "./assets/character.svg";

const CHARACTER_SIZE = 96; // draw size in CSS px (width = height)
const HIT_RADIUS = 44;

const characterImg = new Image();
let characterReady = false;
characterImg.onload = () => {
  characterReady = true;
};
characterImg.src = characterUrl;

function drawCharacter(cx: number, cy: number) {
  if (!characterReady) return;
  ctx.drawImage(
    characterImg,
    cx - CHARACTER_SIZE / 2,
    cy - CHARACTER_SIZE / 2,
    CHARACTER_SIZE,
    CHARACTER_SIZE
  );
}

// -------- whip-crack sound (synthesized; no asset shipped) ----------------
let audioCtx: AudioContext | null = null;
function getAudio() {
  if (!audioCtx)
    audioCtx = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
  return audioCtx;
}

function crack(volume: number) {
  const ac = getAudio();
  const now = ac.currentTime;
  const dur = 0.12;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    const env = Math.pow(1 - t, 3) * (t < 0.02 ? t / 0.02 : 1);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800;
  bp.Q.value = 1.4;
  const gain = ac.createGain();
  gain.gain.value = Math.min(1, volume) * 0.6;
  src.connect(bp).connect(gain).connect(ac.destination);
  src.start(now);
  src.stop(now + dur);
}

// -------- input + main loop -----------------------------------------------
let mouseX = 0;
let mouseY = 0;
let initialized = false;
let gripping = false;
let anchorX = 0;
let anchorY = 0;

// Track the cursor at window level so dragging past the canvas (or into
// the bubble's rounded-corner gap) doesn't stop updates or release grip.
window.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left;
  mouseY = e.clientY - r.top;
  if (!initialized) {
    initWhip(mouseX, mouseY);
    initialized = true;
  }
});

canvas.addEventListener("mousedown", (e) => {
  const r = canvas.getBoundingClientRect();
  // Anchor the joint at the click position. The joint stays here (with
  // heavy spring give) while the cursor's offset rotates the butt around
  // it. Reset gripDir to the resting direction so the very first frame
  // of gripping matches the non-grip pose — no visual jump or collapse.
  anchorX = e.clientX - r.left;
  anchorY = e.clientY - r.top;
  gripDirX = -Math.cos(HANDLE_ANGLE);
  gripDirY = -Math.sin(HANDLE_ANGLE);
  gripping = true;
});
// Release on window so it fires even if the cursor left the canvas
// before the user lifted the button. Don't react to mouseleave at all.
window.addEventListener("mouseup", () => {
  gripping = false;
});

let lastTip = { x: 0, y: 0 };
let cooldown = 0;
let flashCharacter = 0;

function frame() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cx = w / 2;
  const cy = h / 2;

  if (!initialized) {
    initWhip(cx + 60, cy);
    initialized = true;
  }

  // Clear the entire backing store, not just the transformed CSS area, so
  // any sub-pixel edge strip can't accumulate trails.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  drawCharacter(cx, cy);

  stepWhip(mouseX || cx + 60, mouseY || cy, gripping, anchorX, anchorY);
  drawWhip();

  const tip = nodes[nodes.length - 1];
  const speed = Math.hypot(tip.x - lastTip.x, tip.y - lastTip.y);
  lastTip = { x: tip.x, y: tip.y };

  if (cooldown > 0) cooldown--;
  const dx = tip.x - cx;
  const dy = tip.y - cy;
  const inside = dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS;
  if (inside && speed > 8 && cooldown === 0) {
    crack(Math.min(1, speed / 30));
    cooldown = 12;
    flashCharacter = 6;
  }

  if (flashCharacter > 0) {
    ctx.save();
    ctx.globalAlpha = flashCharacter / 6;
    ctx.fillStyle = "rgba(255, 80, 80, 0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, HIT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    flashCharacter--;
  }

  requestAnimationFrame(frame);
}

frame();
