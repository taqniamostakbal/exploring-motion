'use strict';
// Bolm Motion — Electron main process (shell).
// Mirrors the proven Bolm Browser pattern: single main window, context
// isolation on, node integration off, renderer talks via preload IPC only.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#14121f',
    title: 'Exploring Motion',
    icon: require('path').join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });

// ---- File IPC (project save/load + media import) ----
ipcMain.handle('bm:save-project', async (_e, json, suggested) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save Exploring Motion project',
    defaultPath: suggested || 'project.bolmmotion.json',
    filters: [{ name: 'Exploring Motion project', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, json, 'utf8');
  return { ok: true, path: r.filePath };
});

ipcMain.handle('bm:open-project', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open Exploring Motion project',
    properties: ['openFile'],
    filters: [{ name: 'Exploring Motion project', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('bm:pick-media', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav', 'ogg'] }]
  });
  if (r.canceled) return { ok: false, canceled: true };
  return { ok: true, paths: r.filePaths };
});

// ---- M4: video export (frames from the renderer, encoded with FFmpeg) ----
function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}
function safeExportDir(dir) {
  const full = path.resolve(String(dir || ''));
  const tmp = path.resolve(os.tmpdir());
  if (!full.startsWith(tmp) || !path.basename(full).startsWith('em-export-')) throw new Error('bad export dir');
  return full;
}
// ---- M5: media probe, filmstrip thumbnails, audio peaks ----
function ffmpegCapture(args) {
  return new Promise(resolve => {
    const chunks = [], echunks = [];
    const ff = spawn(ffmpegPath(), args, { windowsHide: true });
    ff.stdout.on('data', ch => chunks.push(ch));
    ff.stderr.on('data', ch => echunks.push(ch));
    ff.on('error', () => resolve({ code: -2, stdout: Buffer.concat(chunks), stderr: Buffer.concat(echunks).toString() }));
    ff.on('close', code => resolve({ code, stdout: Buffer.concat(chunks), stderr: Buffer.concat(echunks).toString() }));
  });
}
ipcMain.handle('bm:probe-media', async (_e, filePath) => {
  const { stderr } = await ffmpegCapture(['-i', String(filePath)]);
  const dm = stderr.match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
  const vm = stderr.match(/Video:.*?(\d{3,5})x(\d{3,5})/);
  const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]) : 0;
  return { ok: duration > 0, duration, width: vm ? +vm[1] : 0, height: vm ? +vm[2] : 0, hasAudio: /Audio:/.test(stderr), hasVideo: !!vm };
});
ipcMain.handle('bm:video-thumbs', async (_e, filePath, times) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-thumbs-'));
  const files = [];
  for (let i = 0; i < times.length; i++) {
    const out = path.join(dir, 'thumb_' + String(i).padStart(3, '0') + '.png');
    const { code } = await ffmpegCapture(['-ss', String(times[i]), '-i', String(filePath), '-frames:v', '1', '-vf', 'scale=144:-2', '-y', out]);
    if (code === 0 && fs.existsSync(out)) files.push(out);
  }
  return { ok: files.length > 0, dir, files };
});
ipcMain.handle('bm:audio-peaks', async (_e, filePath, count) => {
  const n = Math.min(600, Math.max(60, count || 240));
  const { code, stdout } = await ffmpegCapture(['-v', 'error', '-i', String(filePath), '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
  if (code !== 0 || !stdout.length) return { ok: false };
  const total = Math.floor(stdout.length / 2);
  const peaks = new Array(n).fill(0);
  const per = total / n;
  for (let i = 0; i < n; i++) {
    let mx = 0;
    const s0 = Math.floor(i * per), s1 = Math.max(s0 + 1, Math.floor((i + 1) * per));
    for (let s = s0; s < s1 && s < total; s++) { const v = Math.abs(stdout.readInt16LE(s * 2)); if (v > mx) mx = v; }
    peaks[i] = Math.round((mx / 32768) * 1000) / 1000;
  }
  return { ok: true, peaks };
});
ipcMain.handle('bm:export-start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-export-'));
  return { ok: true, dir };
});
ipcMain.handle('bm:export-frame', async (_e, dir, index, dataUrl) => {
  const d = safeExportDir(dir);
  const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(d, 'frame_' + String(index).padStart(5, '0') + '.png'), Buffer.from(b64, 'base64'));
  return { ok: true };
});
ipcMain.handle('bm:export-abort', async (_e, dir) => {
  try { fs.rmSync(safeExportDir(dir), { recursive: true, force: true }); } catch (e) { /* already gone */ }
  return { ok: true };
});
ipcMain.handle('bm:export-finish', async (_e, dir, opts) => {
  const d = safeExportDir(dir);
  const fmt = opts.format, fps = Math.max(1, Math.round(opts.fps || 30));
  const base = (opts.name || 'exploring-motion').replace(/[^\w\- ]+/g, '').trim() || 'exploring-motion';
  const preset = process.env.EM_EXPORT_PATH; // automated-test override only
  let outPath = null, outDir = null;
  if (fmt === 'pngseq') {
    if (preset) { outDir = preset; }
    else {
      const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for the PNG sequence', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths.length) { fs.rmSync(d, { recursive: true, force: true }); return { ok: false, canceled: true }; }
      outDir = path.join(r.filePaths[0], base + '-frames');
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(d)) fs.copyFileSync(path.join(d, f), path.join(outDir, f));
    fs.rmSync(d, { recursive: true, force: true });
    return { ok: true, path: outDir };
  }
  const ext = fmt === 'webm' ? 'webm' : fmt === 'gif' ? 'gif' : 'mp4';
  if (preset) { outPath = preset; }
  else {
    const r = await dialog.showSaveDialog(win, {
      title: 'Export video',
      defaultPath: base + '.' + ext,
      filters: [{ name: fmt.toUpperCase(), extensions: [ext] }]
    });
    if (r.canceled || !r.filePath) { fs.rmSync(d, { recursive: true, force: true }); return { ok: false, canceled: true }; }
    outPath = r.filePath;
  }
  const pattern = path.join(d, 'frame_%05d.png');
  const audios = (opts.audios || []).filter(a => a && a.path && fs.existsSync(a.path));
  const inputs = ['-framerate', String(fps), '-i', pattern];
  let audioFc = null;
  if (fmt !== 'gif' && audios.length) {
    const fc = [];
    audios.forEach((a, i) => {
      inputs.push('-ss', String(Math.max(0, a.offset || 0)), '-i', a.path);
      const startMs = Math.round(Math.max(0, a.start || 0) * 1000);
      const keep = Math.max(0.1, (opts.duration || 0) - (a.start || 0));
      fc.push('[' + (i + 1) + ':a]atrim=0:' + keep.toFixed(3) + ',adelay=' + startMs + ':all=1,volume=' + Math.min(1, Math.max(0, a.volume == null ? 1 : a.volume)).toFixed(3) + '[a' + i + ']');
    });
    fc.push(audios.map((_, i) => '[a' + i + ']').join('') + 'amix=inputs=' + audios.length + ':duration=first:dropout_transition=0[amix];[amix]apad=whole_dur=' + (opts.duration || 0).toFixed(3) + '[aout]');
    audioFc = fc.join(';');
  }
  let args;
  if (fmt === 'webm') args = ['-y', ...inputs, ...(audioFc ? ['-filter_complex', audioFc, '-map', '0:v', '-map', '[aout]', '-c:a', 'libopus'] : []), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '26', '-pix_fmt', 'yuv420p', outPath];
  else if (fmt === 'gif') args = ['-y', '-framerate', String(fps), '-i', pattern, '-filter_complex', 'split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4', outPath];
  else args = ['-y', ...inputs, ...(audioFc ? ['-filter_complex', audioFc, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', outPath];
  const code = await new Promise(resolve => {
    let err = '';
    const ff = spawn(ffmpegPath(), args, { windowsHide: true });
    ff.stderr.on('data', ch => { err += ch.toString(); });
    ff.on('error', () => resolve(-2));
    ff.on('close', cd => { if (cd !== 0) console.error('[export] ffmpeg failed:', err.slice(-800)); resolve(cd); });
  });
  fs.rmSync(d, { recursive: true, force: true });
  if (code !== 0) return { ok: false, error: 'ffmpeg exited ' + code };
  return { ok: true, path: outPath };
});
