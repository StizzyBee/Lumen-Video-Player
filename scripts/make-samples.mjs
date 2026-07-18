// Generates real, playable sample videos (VP9 WebM) into the user's Videos
// folder using an offscreen Electron window — no external tools needed.
// Run: npx electron scripts/make-samples.mjs
import { app, BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'

const SPECS = [
  { file: 'Lumen Sample — Aurora (1080p).webm', label: 'Aurora', seconds: 8, width: 1920, height: 1080, hue: 230 },
  { file: 'Lumen Sample — Ember (720p).webm', label: 'Ember', seconds: 8, width: 1280, height: 720, hue: 18 },
  { file: 'Lumen Sample — Meadow (1080p).webm', label: 'Meadow', seconds: 22, width: 1920, height: 1080, hue: 130 }
]

const recorderScript = (spec) => `
(async () => {
  const W = ${spec.width}, H = ${spec.height}, SECONDS = ${spec.seconds}, HUE = ${spec.hue}, LABEL = ${JSON.stringify(spec.label)};
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const audio = new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.04;
  osc.frequency.value = 220;
  const dest = audio.createMediaStreamDestination();
  osc.connect(gain); gain.connect(dest);
  osc.start();

  const stream = canvas.captureStream(30);
  for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 5_000_000 });
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });

  const t0 = performance.now();
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'hsl(' + (HUE + Math.sin(t * 0.7) * 24) + ' 60% ' + (16 + Math.sin(t * 0.9) * 6) + '%)');
    g.addColorStop(1, 'hsl(' + (HUE + 40 + Math.cos(t * 0.5) * 30) + ' 70% 42%)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 5; i++) {
      const x = W * (0.5 + 0.38 * Math.sin(t * (0.6 + i * 0.13) + i * 1.7));
      const y = H * (0.5 + 0.34 * Math.cos(t * (0.5 + i * 0.11) + i * 2.4));
      const r = H * (0.06 + 0.035 * Math.sin(t * 0.8 + i));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + (HUE + i * 26) + ' 85% 70% / 0.35)';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 ' + Math.round(H * 0.09) + 'px "Segoe UI Variable Display", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(LABEL, W / 2, H * 0.5);
    ctx.font = '500 ' + Math.round(H * 0.045) + 'px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(t.toFixed(1) + 's — Lumen sample media', W / 2, H * 0.6);
    osc.frequency.value = 180 + 60 * Math.sin(t * 0.9);
  };
  const timer = setInterval(draw, 1000 / 30);
  draw();

  rec.start(500);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  rec.stop();
  await done;
  clearInterval(timer);
  osc.stop(); await audio.close();

  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
})()
`

async function main() {
  await app.whenReady()
  const outDir = join(app.getPath('videos'), 'Lumen Samples')
  await fsp.mkdir(outDir, { recursive: true })

  const win = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, offscreen: false }
  })
  await win.loadURL('data:text/html,<title>sample</title>')

  for (const spec of SPECS) {
    process.stdout.write(`Recording ${spec.file} (${spec.seconds}s)… `)
    const b64 = await win.webContents.executeJavaScript(recorderScript(spec), true)
    const buf = Buffer.from(b64, 'base64')
    await fsp.writeFile(join(outDir, spec.file), buf)
    console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`)
  }

  console.log('DONE ' + outDir)
  app.exit(0)
}

main().catch((e) => {
  console.error(e)
  app.exit(1)
})
