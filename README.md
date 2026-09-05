# Aurality — AI Voice Assistant

Speech → Transcription → LLM → Text‑to‑Speech, wrapped in a live chat UI that
shows every stage of the pipeline as it happens.

## What's new in this version
- **Chat-style interface** instead of a single-shot form — the assistant
  remembers the conversation (per browser, in memory on the server).
- **Live waveform** in the side rail, driven by your actual microphone input
  while recording, plus a resting animation the rest of the time.
- **Real pipeline visibility**: Speech → Transcribe → Think → Speak lights up
  stage by stage as your request actually moves through STT, the LLM, and TTS
  (three separate API calls, not one big black box).
- **Selectable voice** for the spoken replies, and a light/dark theme toggle.
- **Per-message audio player** with its own waveform and a download link.
- Backend bug fixes: the transcription and TTS model names, plus the voice,
  are now actually read from `.env` (the previous version had them
  hardcoded), and the audio response is served with the correct `audio/wav`
  content type.

## Run locally
```bash
python -m venv .venv
.venv\Scripts\activate        # on Windows
# source .venv/bin/activate   # on macOS/Linux
pip install -r requirements.txt
```

Your `.env` file already has your Gemini API key and model names in it — the
project reads them automatically. If you ever need to reset it, copy
`.env.example` to `.env` and fill in your own key:

```
GEMINI_API_KEY=...
GEMINI_LLM_MODEL=gemini-2.5-flash
GEMINI_TRANSCRIPTION_MODEL=gemini-2.5-flash
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
```

> **Check your `.env` values.** A couple of entries in the copy you sent look
> like placeholders rather than real Gemini identifiers — in particular
> `GEMINI_TTS_VOICE=alloy` is an OpenAI voice name, not one of Gemini's
> (Gemini voices include `Kore`, `Puck`, `Zephyr`, `Charon`, and others — the
> app's voice dropdown lists a working set). If speech generation errors out,
> that's the first thing to check.

Then run the server:
```bash
uvicorn app.main:app --reload
```
Open http://127.0.0.1:8000

## How it works
1. `POST /api/transcribe` — audio in, transcript out (speech-to-text).
2. `POST /api/chat` — text in, LLM answer out, aware of the last several
   turns of the conversation (`conversation_id` keeps them separate per
   browser tab/user).
3. `POST /api/speak` — text in, spoken `.wav` out, with a chosen voice.
4. `POST /api/reset` — clears a conversation's memory.
5. `GET /api/voices` — the list of voices shown in the UI dropdown.

The frontend calls these in sequence and updates the pipeline indicator as
each one resolves, so the three-stage architecture the project is built
around is visible, not hidden behind a single spinner.

## Project structure
```
app/
  main.py                    FastAPI routes
  services/
    gemini_client.py         Gemini client + model/voice config from .env
    voice_pipeline.py        transcribe / generate_answer / synthesize_speech
  static/
    index.html
    style.css
    app.js
data/audio/                  generated speech clips
```

## Extensions worth trying next
- Streaming the LLM's answer token-by-token instead of waiting for the full
  reply.
- Swapping the in-memory conversation store for a small SQLite file so
  history survives a server restart.
- A RAG knowledge base for course-specific questions.
- Multiple languages, selectable per conversation.
