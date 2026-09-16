from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.services.voice_pipeline import (
    VOICES,
    generate_answer,
    synthesize_speech,
    transcribe_audio,
)

BASE_DIR = Path(__file__).resolve().parent
app = FastAPI(title="Aurality Voice Assistant", version="2.0.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    """
    Catch anything that isn't already an HTTPException (e.g. the Gemini SDK
    rejecting a bad model/voice name) and return real JSON instead of a bare
    500 that the frontend's response.json() can't parse. The full traceback
    still prints to the uvicorn terminal for debugging.
    """
    import traceback

    traceback.print_exc()
    message = str(exc) or exc.__class__.__name__
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {message}"},
    )

# Simple in-memory store: conversation_id -> list of {"role", "text"} turns.
# Good enough for a local student project; swap for a DB if this ever needs
# to survive a server restart or run across multiple workers.
CONVERSATIONS: dict[str, list[dict]] = {}
MAX_STORED_TURNS = 24


def _history(conversation_id: str) -> list[dict]:
    return CONVERSATIONS.setdefault(conversation_id, [])


def _remember(conversation_id: str, role: str, text: str) -> None:
    hist = _history(conversation_id)
    hist.append({"role": role, "text": text})
    del hist[: -MAX_STORED_TURNS]


class ChatRequest(BaseModel):
    text: str
    conversation_id: str


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None


@app.get("/")
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/voices")
def list_voices():
    return {"voices": VOICES}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Stage 1: Speech -> text."""
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is required.")

    suffix = Path(audio.filename).suffix or ".webm"
    temp = Path("data") / f"input-{uuid4().hex}{suffix}"
    temp.parent.mkdir(exist_ok=True)
    try:
        temp.write_bytes(await audio.read())
        transcript = transcribe_audio(temp)
        if not transcript:
            raise HTTPException(
                status_code=422, detail="Couldn't make out any speech in that clip."
            )
        return {"transcript": transcript}
    finally:
        temp.unlink(missing_ok=True)


@app.post("/api/chat")
def chat(request: ChatRequest):
    """Stage 2: text -> LLM answer, remembering the conversation so far."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Please enter some text.")

    conversation_id = request.conversation_id
    answer = generate_answer(text, _history(conversation_id))
    _remember(conversation_id, "user", text)
    _remember(conversation_id, "assistant", answer)
    return {"answer": answer}


@app.post("/api/speak")
def speak(request: SpeakRequest):
    """Stage 3: text -> spoken audio."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to speak.")

    audio = synthesize_speech(text, request.voice)
    return {"audio_url": f"/api/audio/{audio.name}"}


@app.post("/api/reset")
def reset(conversation_id: str = Form(...)):
    CONVERSATIONS.pop(conversation_id, None)
    return {"status": "cleared"}


@app.get("/api/audio/{filename}")
def get_audio(filename: str):
    path = Path("data/audio") / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found.")
    return FileResponse(path, media_type="audio/wav", filename=filename)
