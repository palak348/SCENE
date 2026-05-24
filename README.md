# 🎬 SCENE — AI-directed emotional cinema

> **Har baat ek scene hai.** Turn any line, voice note, or chat screenshot into a
> dramatic cinematic performance — voiced with emotional Hinglish by **Rumik's Silk** TTS.

SCENE listens to ordinary speech / text / a chat screenshot, and an AI *directs* it
into an over-the-top emotional scene, then **performs** it as a cinematic voice clip —
with a live waveform, mood-reactive lighting, and word-by-word captions.

---

## How it works

```
🎙️ voice  /  ⌨️ text  /  📷 chat screenshot
        │
        ▼
   Gemini  →  writes the dramatic Hinglish scene (with emotion tags)
        │
        ▼
   Silk (Rumik)  →  performs it as expressive Hinglish speech
        │
        ▼
   🔊 cinematic player — waveform · captions · emotion lighting
```

- **Ears + Director:** Gemini hears the audio / reads the text or screenshot and writes
  the scene, tagging emotion (`<gasp>`, `<angry>`, `<cry>`, `<whisper>`…).
- **Voice:** Silk (`mulberry`) turns that tagged script into emotional Hinglish audio.
- **Experience:** an audio-first cinematic player — not a wall of text.

---

## Run it locally

```bash
# 1. setup
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt

# 2. add your keys
copy .env.example .env          # then edit .env and paste your keys

# 3. run
uvicorn server:app --reload
```

Open **http://localhost:8000** in Chrome or Edge.

You need two keys in `.env`:
- `GEMINI_API_KEY` — free from https://aistudio.google.com
- `SILK_API_KEY` — from Rumik's Silk dashboard

---

## Tech

- **Backend:** Python · FastAPI · Google Gemini (audio + text + vision) · Silk TTS
- **Frontend:** vanilla HTML / CSS / JS — atmospheric cinematic UI, live `<canvas>`
  waveform, reactive mood lighting, no framework overhead
- **Resilience:** automatic Gemini model-rotation on quota/access limits, and a
  browser-voice fallback if Silk is unavailable — the demo never goes silent.

## Project layout

```
server.py          FastAPI: /chat (voice) · /dramatize-text · /dramatize-image · Silk
systemprompt.md    the "director" prompt (edit to change behaviour — no restart)
static/            index.html · app.js · style.css
.env.example       copy to .env and add your keys
requirements.txt
```

---

Built for **Rumik AI's Silk hackathon**.
