"""
Filmy — Cinematic Voice Drama — FastAPI backend.

Pipeline:  mic audio (WAV)  ->  Gemini (hears + replies in Hinglish + tags)  ->  speak()
speak() uses Silk if SILK_API_KEY is set, otherwise returns None so the browser
falls back to its built-in voice. This is the safe-baseline -> Silk upgrade path.

Run:  uvicorn server:app --reload
Then open http://localhost:8000
"""

import base64
import io
import json
import os
import re
import wave
from pathlib import Path

import httpx
from dotenv import load_dotenv, dotenv_values
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from google import genai
from google.genai import types

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
load_dotenv()

BASE_DIR = Path(__file__).parent
# Prefer a key set in .env; otherwise fall back to the OS environment variable.
_env_file = dotenv_values(BASE_DIR / ".env")
GEMINI_API_KEY = (_env_file.get("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY", "")).strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview").strip()

# Auto-rotation: each model has its OWN free-tier daily quota. When one hits 429,
# we fall to the next — giving ~150+ free requests/day across all of them.
# Override the order with GEMINI_MODELS="a,b,c" in .env if you like.
_default_models = [
    GEMINI_MODEL,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
    "gemini-3.1-flash-lite",
]
_env_models = [m.strip() for m in os.getenv("GEMINI_MODELS", "").split(",") if m.strip()]
_seen = set()
MODELS = [m for m in (_env_models or _default_models) if not (m in _seen or _seen.add(m))]
_active = {"i": 0}  # index of the model that last worked

# Silk TTS (Rumik) — real API per the official docs.
SILK_API_KEY = os.getenv("SILK_API_KEY", "").strip()
SILK_API_BASE = os.getenv("SILK_API_BASE", "https://silk-api.rumik.ai").strip()
SILK_MODEL = os.getenv("SILK_MODEL", "mulberry").strip()  # "mulberry" (expressive) or "muga" (fast)
SILK_DESCRIPTION = os.getenv(
    "SILK_DESCRIPTION",
    "a deep booming hindi dramatic_narrator, high intensity, energetic, fast varied theatrical pacing",
).strip()

# The system prompt is the single source of truth in systemprompt.md.
# Edit that file to change Filmy's behaviour — no code changes, no restart needed.
SYSTEM_PROMPT_PATH = BASE_DIR / "systemprompt.md"


def get_system_prompt() -> str:
    """Read the prompt fresh each request so edits to systemprompt.md apply live
    (no server restart). The file is tiny, so the read cost is negligible."""
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")

if not GEMINI_API_KEY:
    print("\n  WARNING: GEMINI_API_KEY is not set. Add it to .env to enable replies.")
    print("  Get a free key at https://aistudio.google.com -> 'Get API key'\n")

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


# ----------------------------------------------------------------------------
# Structured output schema  ->  forces Gemini to return {heard, reply}
# ----------------------------------------------------------------------------
class AgentReply(BaseModel):
    heard: str   # what the user said (for the on-screen transcript)
    reply: str   # Filmy's cinematic spoken reply, with emotion tags


# ----------------------------------------------------------------------------
# Conversation memory (simple in-memory history for a single demo session).
# We store TEXT only (the transcript + replies), never re-uploading old audio.
# ----------------------------------------------------------------------------
history: list[types.Content] = []


def reset_history() -> None:
    history.clear()


# ----------------------------------------------------------------------------
# Silk TTS (Rumik) — POST /v1/tts returns a 24 kHz mono WAV.
# A single call maxes out at ~25s of audio (the model's token ceiling — raising
# max_new_tokens doesn't help, it just 502s). So we split long replies into
# sentence-sized chunks, synthesize each, and stitch the WAV together — exactly
# what Silk's docs recommend ("Beyond 40s: split across prompts").
# Returns base64-encoded WAV, or None to trigger the browser-voice fallback.
# ----------------------------------------------------------------------------
SILK_CHUNK_CHARS = 240  # ~15s of speech, comfortably under the ~25s/call ceiling


def _split_for_tts(text: str, limit: int = SILK_CHUNK_CHARS) -> list[str]:
    """Break text into chunks at sentence boundaries, each under `limit` chars,
    keeping emotion tags with the text that follows them."""
    # Split into sentences but keep the punctuation that ends each one.
    sentences = re.findall(r"[^.!?]+[.!?]*\s*", text) or [text]
    chunks, cur = [], ""
    for s in sentences:
        if cur and len(cur) + len(s) > limit:
            chunks.append(cur.strip())
            cur = s
        else:
            cur += s
    if cur.strip():
        chunks.append(cur.strip())
    return chunks or [text]


def _silk_one(text: str) -> bytes:
    """Synthesize a single chunk, retrying transient 502s. Returns raw WAV bytes."""
    payload = {"model": SILK_MODEL, "text": text, "temperature": 0.85}
    if SILK_MODEL == "mulberry" and SILK_DESCRIPTION:
        payload["description"] = SILK_DESCRIPTION  # natural-language voice persona
    last = None
    for attempt in range(3):
        resp = httpx.post(
            f"{SILK_API_BASE}/v1/tts",
            headers={"Authorization": f"Bearer {SILK_API_KEY}"},
            json=payload,
            timeout=60.0,
        )
        if resp.status_code == 502:  # transient upstream hiccup — retry
            last = resp
            continue
        resp.raise_for_status()
        return resp.content
    last.raise_for_status()  # exhausted retries


def _concat_wavs(wavs: list[bytes]) -> bytes:
    """Join multiple 24 kHz mono WAVs into one by concatenating their PCM frames."""
    if len(wavs) == 1:
        return wavs[0]
    frames, params = [], None
    for w in wavs:
        with wave.open(io.BytesIO(w), "rb") as r:
            params = params or r.getparams()
            frames.append(r.readframes(r.getnframes()))
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setparams(params)
        wf.writeframes(b"".join(frames))
    return out.getvalue()


def speak_silk(text: str) -> str | None:
    if not SILK_API_KEY:
        return None
    try:
        chunks = _split_for_tts(text)
        wavs = [_silk_one(c) for c in chunks]
        combined = _concat_wavs(wavs)
        if len(chunks) > 1:
            print(f"[Silk] synthesized {len(chunks)} chunks and stitched them")
        return base64.b64encode(combined).decode("ascii")  # 24 kHz mono WAV
    except Exception as e:  # never let TTS crash the demo — fall back to browser voice
        print(f"[Silk] failed, using browser fallback: {e}")
        return None


# ----------------------------------------------------------------------------
# Gemini  (audio in -> {heard, reply})
# ----------------------------------------------------------------------------
def _is_quota_error(e: Exception) -> bool:
    # Rotate to the next model on quota (429), access-denied (403), or not-found (404)
    # — so a restricted/preview model never crashes the request, it just gets skipped.
    msg = str(e)
    return any(k in msg for k in (
        "RESOURCE_EXHAUSTED", "429", "PERMISSION_DENIED", "403", "NOT_FOUND", "404"))


def ask_gemini(media_bytes: bytes, mime_type: str) -> AgentReply:
    """Mic audio OR chat screenshot -> {heard, reply}. Gemini handles the modality
    from the mime type."""
    media_part = types.Part.from_bytes(data=media_bytes, mime_type=mime_type)
    return _run_gemini(types.Content(role="user", parts=[media_part]))


def ask_gemini_text(text: str) -> AgentReply:
    """Typed line -> {heard, reply}. Same brain as the mic, just a text part."""
    return _run_gemini(types.Content(role="user", parts=[types.Part(text=text)]))


def _run_gemini(user_turn: types.Content) -> AgentReply:
    config = types.GenerateContentConfig(
        system_instruction=get_system_prompt(),
        response_mime_type="application/json",
        response_schema=AgentReply,
        temperature=1.0,  # higher = more spontaneous / less templated
    )

    last_err = None
    # Try the active model first, then rotate through the rest on quota errors.
    for attempt in range(len(MODELS)):
        idx = (_active["i"] + attempt) % len(MODELS)
        model = MODELS[idx]
        try:
            response = client.models.generate_content(
                model=model, contents=history + [user_turn], config=config
            )
            _active["i"] = idx  # stick with whatever worked
            if attempt > 0:
                print(f"[Gemini] rotated to working model: {model}")

            parsed = getattr(response, "parsed", None)
            if isinstance(parsed, AgentReply):
                result = parsed
            else:
                result = AgentReply(**json.loads(response.text))

            # Safety net: Silk tags are single markers, never paired. Strip any stray
            # closing tags (e.g. </angry>) so they can't be read aloud as garbage.
            result.reply = re.sub(r"</[^>]*>", "", result.reply).replace("  ", " ").strip()

            # Store TEXT-only turns so context is kept cheaply (no re-sent audio).
            history.append(types.Content(role="user", parts=[types.Part(text=result.heard)]))
            history.append(types.Content(role="model", parts=[types.Part(text=result.reply)]))
            return result
        except Exception as e:
            if _is_quota_error(e):
                last_err = e
                print(f"[Gemini] {model} quota exhausted -> trying next model...")
                continue
            raise  # non-quota error: surface it

    raise last_err or RuntimeError("All models exhausted")


# ----------------------------------------------------------------------------
# FastAPI app
# ----------------------------------------------------------------------------
app = FastAPI(title="Filmy — Cinematic Voice Drama")


@app.get("/health")
def health():
    return {
        "gemini_ready": client is not None,
        "active_model": MODELS[_active["i"]],
        "model_pool": MODELS,
        "silk_ready": bool(SILK_API_KEY),
        "silk_model": SILK_MODEL,
        "turns": len(history) // 2,
    }


@app.post("/reset")
def reset():
    reset_history()
    return {"ok": True}


@app.post("/chat")
async def chat(audio: UploadFile = File(...)):
    if client is None:
        return JSONResponse(
            status_code=503,
            content={"error": "GEMINI_API_KEY not set. Add it to .env and restart."},
        )

    audio_bytes = await audio.read()
    mime_type = audio.content_type or "audio/wav"

    try:
        result = ask_gemini(audio_bytes, mime_type)
    except Exception as e:
        print(f"[Gemini] error: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Gemini call failed: {e}"},
        )

    audio_base64 = speak_silk(result.reply)  # None -> browser voice fallback

    return {
        "heard": result.heard,
        "reply": result.reply,
        "audio_base64": audio_base64,   # null until Silk is wired in
        "source": "silk" if audio_base64 else "browser",
    }


@app.post("/dramatize-image")
async def dramatize_image(image: UploadFile = File(...)):
    """Take a chat screenshot, let Gemini read the conversation, and turn it into an
    acted-out cinematic scene performed by Silk. Same {heard, reply, audio} contract
    as /chat so the frontend handles both identically."""
    if client is None:
        return JSONResponse(
            status_code=503,
            content={"error": "GEMINI_API_KEY not set. Add it to .env and restart."},
        )

    image_bytes = await image.read()
    mime_type = image.content_type or "image/png"
    if not mime_type.startswith("image/"):
        return JSONResponse(status_code=400, content={"error": "Please upload an image."})

    try:
        result = ask_gemini(image_bytes, mime_type)
    except Exception as e:
        print(f"[Gemini] image error: {e}")
        return JSONResponse(status_code=500, content={"error": f"Gemini call failed: {e}"})

    audio_base64 = speak_silk(result.reply)
    return {
        "heard": result.heard,
        "reply": result.reply,
        "audio_base64": audio_base64,
        "source": "silk" if audio_base64 else "browser",
    }


class TextIn(BaseModel):
    text: str


@app.post("/dramatize-text")
def dramatize_text(body: TextIn):
    """Take a typed line, run it through the same Filmy brain, and speak it via Silk."""
    if client is None:
        return JSONResponse(
            status_code=503,
            content={"error": "GEMINI_API_KEY not set. Add it to .env and restart."},
        )
    text = (body.text or "").strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "Type something first."})

    try:
        result = ask_gemini_text(text)
    except Exception as e:
        print(f"[Gemini] text error: {e}")
        return JSONResponse(status_code=500, content={"error": f"Gemini call failed: {e}"})

    audio_base64 = speak_silk(result.reply)
    return {
        "heard": result.heard,
        "reply": result.reply,
        "audio_base64": audio_base64,
        "source": "silk" if audio_base64 else "browser",
    }


# Serve the frontend (mounted last so /chat, /reset, /health take precedence).
app.mount("/", StaticFiles(directory=str(BASE_DIR / "static"), html=True), name="static")
