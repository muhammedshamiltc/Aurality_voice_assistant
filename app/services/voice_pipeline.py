from pathlib import Path
from uuid import uuid4
import base64
import wave

from app.services.gemini_client import (
    client,
    LLM_MODEL,
    TRANSCRIPTION_MODEL,
    TTS_MODEL,
    DEFAULT_VOICE,
)

AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

SYSTEM_PROMPT = (
    "You are Aurality, a sharp and friendly AI voice assistant built for college "
    "students. Answer clearly and naturally, the way you'd actually speak out loud. "
    "Keep responses concise enough to be comfortable when spoken aloud. Avoid "
    "markdown, headings, tables, or bullet points - reply in plain conversational "
    "sentences."
)

# A curated subset of Gemini's prebuilt voices, each with a short, honest
# description so the dropdown in the UI means something.
VOICES = [
    {"id": "Kore", "label": "Kore", "tone": "Firm"},
    {"id": "Puck", "label": "Puck", "tone": "Upbeat"},
    {"id": "Zephyr", "label": "Zephyr", "tone": "Bright"},
    {"id": "Charon", "label": "Charon", "tone": "Informative"},
    {"id": "Fenrir", "label": "Fenrir", "tone": "Excitable"},
    {"id": "Leda", "label": "Leda", "tone": "Youthful"},
    {"id": "Aoede", "label": "Aoede", "tone": "Breezy"},
    {"id": "Orus", "label": "Orus", "tone": "Firm"},
]

MAX_HISTORY_TURNS = 8


def transcribe_audio(audio_path: Path) -> str:
    """Turn a recorded audio clip into text using Gemini speech-to-text."""

    audio_file = client.files.upload(file=str(audio_path))

    response = client.models.generate_content(
        model=TRANSCRIPTION_MODEL,
        contents=[
            audio_file,
            "Transcribe the speech in this audio exactly. Return only the "
            "spoken words, with no extra commentary.",
        ],
    )

    return (response.text or "").strip()


def generate_answer(user_text: str, history: list[dict] | None = None) -> str:
    """Generate a reply from the LLM, aware of the recent conversation."""

    history = history or []
    turns = [
        f"{turn['role'].capitalize()}: {turn['text']}"
        for turn in history[-MAX_HISTORY_TURNS:]
    ]
    turns.append(f"User: {user_text}")

    prompt = f"{SYSTEM_PROMPT}\n\n" + "\n".join(turns) + "\nAssistant:"

    response = client.models.generate_content(
        model=LLM_MODEL,
        contents=prompt,
    )

    return (response.text or "").strip()


def synthesize_speech(text: str, voice: str | None = None) -> Path:
    """Convert text into speech and save it as a WAV file."""

    voice_name = voice or DEFAULT_VOICE

    interaction = client.interactions.create(
        model=TTS_MODEL,
        input=text,
        response_format={"type": "audio"},
        generation_config={"speech_config": [{"voice": voice_name}]},
    )

    audio_data = base64.b64decode(interaction.output_audio.data)

    output_path = AUDIO_DIR / f"{uuid4().hex}.wav"

    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(audio_data)

    return output_path
