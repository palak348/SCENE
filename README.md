<div align="center">

# 🎬 SCENE

### Har baat ek scene hai.

**SCENE turns any boring line, voice note, or chat screenshot into an AI-directed
cinematic performance — voiced with real emotion in Hinglish.**
You speak, type, or paste a chat. An AI *directs* it into a dramatic scene and
**performs it out loud** — like a movie, not a chatbot.

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-3.5%20Flash-8E75FF?logo=googlegemini&logoColor=white)
![Silk TTS](https://img.shields.io/badge/Voice-Rumik%20Silk-FF4D7D)
![Status](https://img.shields.io/badge/demo-live-22c55e)

</div>

---

## ⚡ See it in one example

> **You say:** *"tum badal gaye ho"*
>
> **SCENE performs (in Silk's emotional Hinglish voice):**
> *`<gasp>` Tum... tum badal gaye ho? `<cry>` Wahi aankhein, wahi muskaan...
> par woh insaan ab yahan nahi hai. `<angry>` Kis cheez ne tumhe itna badal diya?!
> `<whisper>` ...ya shayad, main hi kabhi tumhe jaanti hi nahi thi.*

A flat sentence becomes a 10-second cinematic moment — gasp, heartbreak, anger,
a whispered twist — performed aloud. **That's the whole product.**

---

## 🎯 The problem & why SCENE

Text-to-speech today sounds like a robot reading — especially in **Hinglish**, where
most voices fumble the Hindi words and flatten all emotion. So AI voice feels
*functional*, never *felt*.

**SCENE flips that.** Built on **Rumik's Silk** (a Hinglish-native, emotion-rich TTS),
it doesn't just *read* text — it **acts** it. The result is shareable, emotional,
GenZ-native entertainment: your everyday lines, performed like cinema.

## ✨ Features

- 🎙️ **Three ways in** — speak, type, or **paste a chat screenshot** (it acts out the conversation).
- 🎭 **AI director, not a chatbot** — Gemini rewrites your input into a real dramatic scene with emotion cues.
- 🔊 **Emotional Hinglish voice** — performed by Silk: gasps, anger, tears, whispers — mid-sentence.
- 🌌 **Cinematic player** — live waveform, mood-reactive lighting, and single-line captions (audio-first, no text walls).
- 🛟 **Never breaks on stage** — auto-rotates Gemini models on quota/limits, and falls back to a browser voice if needed.
- 🇮🇳 **Made for how India actually talks** — code-mixed Hinglish, in Roman script.

## 🧠 How it works

```
🎙️ voice  /  ⌨️ text  /  📷 chat screenshot
        │
        ▼
   Gemini  ──►  directs it into a dramatic Hinglish scene (with emotion tags)
        │
        ▼
   Silk (Rumik)  ──►  performs it as expressive Hinglish speech
        │
        ▼
   🔊  cinematic player — waveform · emotion lighting · captions
```

- **Director (ears + brain):** Gemini understands your audio / text / screenshot and writes the scene.
- **Performer (voice):** Silk `mulberry` turns the tagged script into emotional Hinglish audio.
- **Stage (experience):** an audio-first player that lights up and reacts to the performance.

## 🚀 Quick start

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows  (use: source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt

copy .env.example .env            # then open .env and paste your two keys
uvicorn server:app --reload
```

Open **http://localhost:8000** in **Chrome or Edge**, and either tap a sample line,
type one, hold the mic, or paste a chat screenshot.

**Keys needed in `.env`:**
| Key | Where to get it |
|-----|-----------------|
| `GEMINI_API_KEY` | free at [aistudio.google.com](https://aistudio.google.com) |
| `SILK_API_KEY` | Rumik's Silk dashboard |

## 🛠️ Tech stack

- **Backend:** Python · FastAPI · Google **Gemini** (audio + text + vision) · **Silk** TTS
- **Frontend:** vanilla HTML / CSS / JS — atmospheric cinematic UI, `<canvas>` waveform,
  emotion-reactive lighting (no framework, zero build step)
- **Reliability:** Gemini model auto-rotation + browser-voice fallback

## 📁 Structure

```
server.py          FastAPI — /chat (voice) · /dramatize-text · /dramatize-image · Silk call
systemprompt.md    the "director" prompt (edit to change behaviour — reloads live)
static/            index.html · app.js · style.css   (the cinematic frontend)
.env.example       copy to .env and add your keys
requirements.txt
```

---

<div align="center">

Built for **Rumik AI's Silk hackathon** · *Ordinary lines. Cinematic emotion.*

</div>
