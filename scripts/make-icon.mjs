// Renders the Lumen app icon to build/icon.png (512×512) using an offscreen
// Electron window. electron-builder converts it to .ico automatically.
// Run: npx electron scripts/make-icon.mjs
import { app, BrowserWindow } from 'electron'
import { promises as fsp } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const script = `
(() => {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');

  // Rounded-square tile with a deep blue-violet gradient
  const r = S * 0.22;
  const tile = new Path2D();
  tile.roundRect(S * 0.04, S * 0.04, S * 0.92, S * 0.92, r);
  const g = x.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#2a3452');
  g.addColorStop(0.45, '#1a2036');
  g.addColorStop(1, '#101322');
  x.fillStyle = g;
  x.fill(tile);

  // Soft inner glow
  const glow = x.createRadialGradient(S * 0.35, S * 0.3, 0, S * 0.35, S * 0.3, S * 0.75);
  glow.addColorStop(0, 'rgba(108, 140, 255, 0.38)');
  glow.addColorStop(1, 'rgba(108, 140, 255, 0)');
  x.save();
  x.clip(tile);
  x.fillStyle = glow;
  x.fillRect(0, 0, S, S);
  x.restore();

  // Play glyph — rounded triangle via thick round joins
  const cx = S * 0.545, cy = S * 0.5, R = S * 0.21;
  const pts = [
    [cx - R * 0.82, cy - R],
    [cx + R * 1.05, cy],
    [cx - R * 0.82, cy + R]
  ];
  x.beginPath();
  x.moveTo(pts[0][0], pts[0][1]);
  x.lineTo(pts[1][0], pts[1][1]);
  x.lineTo(pts[2][0], pts[2][1]);
  x.closePath();
  const pg = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  pg.addColorStop(0, '#9db4ff');
  pg.addColorStop(1, '#6c8cff');
  x.fillStyle = pg;
  x.strokeStyle = pg;
  x.lineWidth = S * 0.075;
  x.lineJoin = 'round';
  x.shadowColor = 'rgba(108, 140, 255, 0.55)';
  x.shadowBlur = S * 0.08;
  x.stroke();
  x.fill();

  return c.toDataURL('image/png').split(',')[1];
})()
`

async function main() {
  await app.whenReady()
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await win.loadURL('data:text/html,<title>icon</title>')
  const b64 = await win.webContents.executeJavaScript(script, true)
  const out = join(HERE, '..', 'build', 'icon.png')
  await fsp.mkdir(dirname(out), { recursive: true })
  await fsp.writeFile(out, Buffer.from(b64, 'base64'))
  console.log('WROTE ' + out)
  app.exit(0)
}

main().catch((e) => {
  console.error(e)
  app.exit(1)
})
