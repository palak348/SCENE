// ---------------------------------------------------------------------------
// SCENE — AI-directed emotional cinema (frontend)
// Composed layout: hero (left) + persistent performance stage (right).
// voice / text / screenshot -> Gemini -> Silk, experienced as a cinematic player.
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_RATE = 16000;

const els = {
  talk: document.getElementById("talk"),
  text: document.getElementById("text"),
  send: document.getElementById("send"),
  shot: document.getElementById("shot"),
  file: document.getElementById("file"),
  reset: document.getElementById("reset"),
  status: document.getElementById("status"),
  nowTag: document.getElementById("nowTag"),
  sceneHeard: document.getElementById("sceneHeard"),
  caption: document.getElementById("caption"),
  waveform: document.getElementById("waveform"),
  playBtn: document.getElementById("playBtn"),
  playIco: document.getElementById("playIco"),
  time: document.getElementById("time"),
};

let audioContext = null, mediaStream = null, sourceNode = null, processor = null;
let recordedChunks = [], recording = false, busy = false;

// ── helpers ──
function setStatus(t, kind = "") { els.status.textContent = t; els.status.className = "scene-status" + (kind ? " " + kind : ""); }
function stripTags(t) { return t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function fmt(s) { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ":" + (x < 10 ? "0" : "") + x; }
function buildSegments(reply) {
  const tokens = reply.split(/(<[a-z_]+>)/i).filter((s) => s !== "");
  const parts = []; let emotion = null;
  for (const tok of tokens) { const m = tok.match(/^<([a-z_]+)>$/i); if (m) emotion = m[1].toLowerCase(); else { const t = tok.trim(); if (t) parts.push({ emotion, text: t }); } }
  return parts.length ? parts : [{ emotion: null, text: stripTags(reply) }];
}
const MOOD = { gasp:"#cfe0ff", angry:"#ff5a4d", cry:"#5aa8ff", scream:"#ff4d7d", excited:"#ffd07a", laugh:"#ffd07a", chuckle:"#ffd07a", giggle:"#ffd07a", whisper:"#b08bff", sarcastic:"#46e0c0", sigh:"#8ea2c8", curious:"#7fd0ff" };

// ── player state ──
const state = { audio: null, raf: null, idleRAF: null, segs: [], curSeg: -1, analyser: null, freq: null };
let playCtx = null;
function getPlayCtx() { if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)(); return playCtx; }
function setPlayIcon(k) { els.playIco.textContent = k === "pause" ? "❚❚" : k === "replay" ? "↻" : "►"; }
function moodColor() { return getComputedStyle(document.body).getPropertyValue("--mood").trim() || "#8b6cff"; }

function stopIdle() { if (state.idleRAF) { cancelAnimationFrame(state.idleRAF); state.idleRAF = null; } }
function clearScene() {
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  stopIdle();
  if (state.audio) { try { state.audio.pause(); } catch (e) {} state.audio = null; }
  state.analyser = null; state.freq = null; state.segs = []; state.curSeg = -1;
  document.body.classList.remove("performing");
  document.body.style.removeProperty("--mood");
}

function setCaption(text, emotion) {
  els.caption.classList.remove("show"); void els.caption.offsetWidth;
  els.caption.textContent = text; els.caption.classList.add("show");
  if (emotion && MOOD[emotion]) document.body.style.setProperty("--mood", MOOD[emotion]);
}
function updateCaption(t, dur) {
  if (!dur || !state.segs.length) return;
  const f = t / dur;
  let idx = state.segs.findIndex((s) => f >= s.start && f < s.end);
  if (idx === -1) idx = state.segs.length - 1;
  if (idx !== state.curSeg) { state.curSeg = idx; const s = state.segs[idx]; setCaption(s.text, s.emotion); }
}

// ── waveform ──
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawBars(progress, animating) {
  const canvas = els.waveform, c = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, bars = 60, bw = W / bars;
  c.clearRect(0, 0, W, H);
  if (state.analyser && animating) state.analyser.getByteFrequencyData(state.freq);
  const mood = moodColor();
  for (let i = 0; i < bars; i++) {
    let v;
    if (state.analyser) { const idx = Math.floor((i / bars) * state.freq.length); v = animating ? state.freq[idx] / 255 : 0.1; }
    else { const t = performance.now() / 260; v = animating ? 0.18 + 0.4 * Math.abs(Math.sin(i * 0.5 + t)) + 0.1 * Math.random() : 0.1; }
    const h = Math.max(3, v * H), x = i * bw, y = (H - h) / 2;
    if ((i / bars) <= progress) { const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#ffd07a"); g.addColorStop(1, mood); c.fillStyle = g; }
    else c.fillStyle = "rgba(255,255,255,0.16)";
    roundRect(c, x + bw * 0.24, y, bw * 0.52, h, 3); c.fill();
  }
}
function drawIdleLoop() {
  const canvas = els.waveform, c = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, bars = 60, bw = W / bars, t = performance.now() / 700;
  c.clearRect(0, 0, W, H); c.fillStyle = "rgba(255,255,255,0.14)";
  for (let i = 0; i < bars; i++) { const v = 0.05 + 0.07 * Math.abs(Math.sin(i * 0.45 + t)); const h = Math.max(3, v * H), x = i * bw, y = (H - h) / 2; roundRect(c, x + bw * 0.24, y, bw * 0.52, h, 3); c.fill(); }
  state.idleRAF = requestAnimationFrame(drawIdleLoop);
}

// ── states ──
function setIdle() {
  clearScene();
  els.nowTag.textContent = "PERFORMANCE STAGE";
  els.sceneHeard.textContent = "";
  setCaption("Press the mic, pick a line, ya ek chat paste karo.", null);
  els.time.textContent = "0:00"; setPlayIcon("play"); setStatus("", "");
  drawIdleLoop();
}
function showDirecting() {
  clearScene();
  els.nowTag.textContent = "DIRECTING…";
  els.sceneHeard.textContent = "";
  setCaption("🎬 Directing your scene…", null);
  setPlayIcon("pause"); els.time.textContent = "0:00";
  setStatus("Writing the scene…", "thinking");
  const loop = () => { drawBars(0, true); state.raf = requestAnimationFrame(loop); };
  loop();
}

function performScene(heard, reply, b64) {
  clearScene();
  els.nowTag.textContent = "NOW PERFORMING";
  els.sceneHeard.textContent = heard || "";
  const segs = buildSegments(reply);
  const total = segs.reduce((a, s) => a + s.text.length, 0) || 1;
  let acc = 0; segs.forEach((s) => { s.start = acc / total; acc += s.text.length; s.end = acc / total; });
  state.segs = segs;
  if (b64) startPlayer(b64); else startFallback(segs);
}

async function startPlayer(b64) {
  const ctx = getPlayCtx(); try { await ctx.resume(); } catch (e) {}
  const audio = new Audio("data:audio/wav;base64," + b64); audio.preload = "auto"; state.audio = audio;
  try {
    const node = ctx.createMediaElementSource(audio);
    state.analyser = ctx.createAnalyser(); state.analyser.fftSize = 256; state.freq = new Uint8Array(state.analyser.frequencyBinCount);
    node.connect(state.analyser); state.analyser.connect(ctx.destination);
  } catch (e) { state.analyser = null; }
  document.body.classList.add("performing"); setStatus("Now performing", "live");
  const loop = () => {
    const dur = audio.duration || 0, prog = dur ? audio.currentTime / dur : 0;
    drawBars(prog, !audio.paused && !audio.ended);
    updateCaption(audio.currentTime, dur); els.time.textContent = fmt(audio.currentTime);
    state.raf = requestAnimationFrame(loop);
  };
  loop();
  audio.addEventListener("ended", () => { setPlayIcon("replay"); document.body.classList.remove("performing"); setStatus("Scene complete · tap ↻ to replay", ""); });
  try { await audio.play(); setPlayIcon("pause"); } catch (e) { setPlayIcon("play"); setStatus("Tap ► to perform", ""); }
}

function startFallback(segs) {
  const text = segs.map((s) => s.text).join(" ");
  const est = Math.max(2.5, text.split(/\s+/).length * 0.42);
  document.body.classList.add("performing"); setStatus("Now performing", "live");
  const t0 = performance.now();
  const loop = () => {
    const t = (performance.now() - t0) / 1000, prog = Math.min(1, t / est);
    drawBars(prog, true); updateCaption(t, est); els.time.textContent = fmt(t);
    if (prog < 1) state.raf = requestAnimationFrame(loop);
    else { document.body.classList.remove("performing"); setPlayIcon("replay"); setStatus("Scene complete", ""); }
  };
  loop();
  if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = "hi-IN"; window.speechSynthesis.speak(u); }
}

els.playBtn.addEventListener("click", async () => {
  const a = state.audio; if (!a) return;
  try { await getPlayCtx().resume(); } catch (e) {}
  if (a.ended) { a.currentTime = 0; await a.play(); setPlayIcon("pause"); document.body.classList.add("performing"); return; }
  if (a.paused) { await a.play(); setPlayIcon("pause"); document.body.classList.add("performing"); }
  else { a.pause(); setPlayIcon("play"); }
});

// ── networking ──
async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok || data.error) {
    clearScene(); els.nowTag.textContent = "PERFORMANCE STAGE";
    setCaption("Kuch gadbad ho gayi — phir try karo.", null);
    setStatus(data.error || "Something went wrong.", "error"); drawIdleLoop(); return;
  }
  performScene(data.heard, data.reply || "", data.audio_base64);
}
async function sendAudio(b) { if (busy) return; busy = true; showDirecting(); const f = new FormData(); f.append("audio", b, "speech.wav"); try { await handleResponse(await fetch("/chat", { method: "POST", body: f })); } catch (e) { setStatus("Network error: " + e.message, "error"); } finally { busy = false; } }
async function sendText(t) { if (busy) return; busy = true; showDirecting(); try { await handleResponse(await fetch("/dramatize-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) })); } catch (e) { setStatus("Network error: " + e.message, "error"); } finally { busy = false; } }
async function sendImage(b) { if (busy) return; busy = true; showDirecting(); const f = new FormData(); f.append("image", b, "chat.png"); try { await handleResponse(await fetch("/dramatize-image", { method: "POST", body: f })); } catch (e) { setStatus("Network error: " + e.message, "error"); } finally { busy = false; } }

// ── mic recording (Web Audio -> WAV) ──
async function ensureMic() {
  if (mediaStream) return;
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => { if (recording) recordedChunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  sourceNode.connect(processor); processor.connect(audioContext.destination);
}
async function startRecording() {
  if (busy || recording) return;
  try { await ensureMic(); if (audioContext.state === "suspended") await audioContext.resume(); }
  catch (e) { setStatus("Mic permission needed — please allow microphone access.", "error"); return; }
  clearScene();
  recordedChunks = []; recording = true;
  els.talk.classList.add("recording"); document.body.classList.add("recording"); document.body.style.removeProperty("--mood");
  els.nowTag.textContent = "LISTENING"; setCaption("Sun raha hoon… release to perform.", null);
  els.time.textContent = "0:00"; setStatus("● Listening…", "live");
  const tick = () => { if (recording) { drawBars(0, true); state.raf = requestAnimationFrame(tick); } };
  tick();
}
async function stopRecording() {
  if (!recording) return;
  recording = false; els.talk.classList.remove("recording"); document.body.classList.remove("recording");
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  const samples = flatten(recordedChunks); recordedChunks = [];
  if (samples.length < audioContext.sampleRate * 0.4) { setStatus("Too short — hold while you speak.", ""); setIdle(); return; }
  let sq = 0; for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
  if (Math.sqrt(sq / samples.length) < 0.012) { setStatus("Didn't catch any speech — try again.", ""); setIdle(); return; }
  await sendAudio(encodeWav(downsample(samples, audioContext.sampleRate, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE));
}
function flatten(chunks) { let n = 0; for (const c of chunks) n += c.length; const o = new Float32Array(n); let k = 0; for (const c of chunks) { o.set(c, k); k += c.length; } return o; }
function downsample(buf, inR, outR) { if (outR >= inR) return buf; const r = inR / outR, n = Math.round(buf.length / r), out = new Float32Array(n); for (let i = 0; i < n; i++) { const nx = Math.round((i + 1) * r); let s = 0, ct = 0; for (let j = Math.round(i * r); j < nx && j < buf.length; j++) { s += buf[j]; ct++; } out[i] = ct ? s / ct : 0; } return out; }
function encodeWav(samples, sr) { const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b); const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }; ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE"); ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, samples.length * 2, true); let o = 44; for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; } return new Blob([v], { type: "audio/wav" }); }

// ── wiring ──
els.talk.addEventListener("pointerdown", (e) => { e.preventDefault(); startRecording(); });
els.talk.addEventListener("pointerup", (e) => { e.preventDefault(); stopRecording(); });
els.talk.addEventListener("pointerleave", () => { if (recording) stopRecording(); });
els.talk.addEventListener("pointercancel", () => { if (recording) stopRecording(); });
function submitText() { const t = els.text.value.trim(); if (!t) return; els.text.value = ""; sendText(t); }
els.send.addEventListener("click", submitText);
els.text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitText(); } });
els.shot.addEventListener("click", () => els.file.click());
els.file.addEventListener("change", () => { const f = els.file.files && els.file.files[0]; if (f) sendImage(f); els.file.value = ""; });
document.addEventListener("paste", (e) => { for (const item of (e.clipboardData?.items || [])) { if (item.type.startsWith("image/")) { const b = item.getAsFile(); if (b) { e.preventDefault(); sendImage(b); } } } });
els.reset.addEventListener("click", async () => { await fetch("/reset", { method: "POST" }); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); setIdle(); });
document.addEventListener("click", (e) => { const p = e.target.closest(".prompt"); if (p && p.dataset.text) sendText(p.dataset.text); });

// boot
setIdle();
