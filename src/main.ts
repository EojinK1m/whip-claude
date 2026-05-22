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
const SEGMENT_COUNT = 22;       // total nodes including the handle
const HANDLE_NODES = 4;         // first N nodes form the stiff handle
const SEGMENT_LEN = 7;          // distance constraint between nodes (px)
const ITER = 18;                // constraint solver passes per frame
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

function stepWhip(handleX: number, handleY: number) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const vx = (n.x - n.px) * DAMPING;
    const vy = (n.y - n.py) * DAMPING;
    n.px = n.x;
    n.py = n.y;
    n.x += vx;
    n.y += vy + GRAVITY;
  }

  nodes[0].x = handleX;
  nodes[0].y = handleY;

  for (let iter = 0; iter < ITER; iter++) {
    // Handle: stiff — only the trailing node moves.
    for (let i = 1; i < HANDLE_NODES; i++) {
      const prev = nodes[i - 1];
      const cur = nodes[i];
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const dist = Math.hypot(dx, dy) || 1;
      const diff = (dist - SEGMENT_LEN) / dist;
      cur.x -= dx * diff;
      cur.y -= dy * diff;
    }
    // Rope: split correction so the lash drapes naturally.
    for (let i = HANDLE_NODES; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const cur = nodes[i];
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const dist = Math.hypot(dx, dy) || 1;
      const diff = (dist - SEGMENT_LEN) / dist;
      const halfX = dx * 0.5 * diff;
      const halfY = dy * 0.5 * diff;
      if (i - 1 >= HANDLE_NODES) {
        prev.x += halfX;
        prev.y += halfY;
      }
      cur.x -= halfX;
      cur.y -= halfY;
    }
    nodes[0].x = handleX;
    nodes[0].y = handleY;
  }
}

function drawWhip() {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Handle
  ctx.strokeStyle = "#6b3a1f";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < HANDLE_NODES; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
  ctx.stroke();

  // Handle grip rings
  ctx.strokeStyle = "#3a1f10";
  ctx.lineWidth = 2;
  for (let i = 1; i < HANDLE_NODES; i++) {
    ctx.beginPath();
    ctx.arc(nodes[i].x, nodes[i].y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rope: taper from thick near handle to thin at the tip.
  for (let i = HANDLE_NODES; i < nodes.length - 1; i++) {
    const t = (i - HANDLE_NODES) / (nodes.length - HANDLE_NODES);
    const width = 5 * (1 - t) + 1.2 * t;
    ctx.strokeStyle = t < 0.7 ? "#2b2117" : "#1a130d";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[i + 1].x, nodes[i + 1].y);
    ctx.stroke();
  }

  // Tip popper
  const tip = nodes[nodes.length - 1];
  ctx.fillStyle = "#0e0a06";
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
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

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouseX = e.clientX - r.left;
  mouseY = e.clientY - r.top;
  if (!initialized) {
    initWhip(mouseX, mouseY);
    initialized = true;
  }
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

  stepWhip(mouseX || cx + 60, mouseY || cy);
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
