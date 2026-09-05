import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

key = os.getenv("GEMINI_API_KEY")

if not key:
    raise RuntimeError("GEMINI_API_KEY is missing. Add it to your .env file.")

client = genai.Client(api_key=key)

# All three pipeline stages read their model name from .env so you can
# swap models without touching any code. These call the Interactions API
# (client.interactions.create), Google's current recommended interface —
# generateContent still works but is now the legacy path.
LLM_MODEL = os.getenv("GEMINI_LLM_MODEL", "gemini-3.6-flash")
TRANSCRIPTION_MODEL = os.getenv("GEMINI_TRANSCRIPTION_MODEL", "gemini-3.6-flash")
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
DEFAULT_VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")
