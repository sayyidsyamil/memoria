"""YouTube audio ingestion and transcription module using Fireworks AI Whisper V3 Turbo."""

import os
import re
import io
import tempfile
from typing import Optional
from dataclasses import dataclass
from pathlib import Path

import requests
from pydantic import BaseModel
from openai import OpenAI


WHISPER_MODEL = "whisper-v3-turbo"
AUDIO_API_BASE_URL = "https://audio-turbo.api.fireworks.ai/v1"


class IngestRequest(BaseModel):
    url: str


class IngestResponse(BaseModel):
    success: bool
    message: str
    transcript: Optional[str] = None
    duration_seconds: Optional[float] = None
    word_count: Optional[int] = None


@dataclass
class TranscriptionResult:
    text: str
    duration_seconds: float
    word_count: int


def extract_youtube_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def download_youtube_audio(url: str, output_path: str) -> float:
    """Download audio from YouTube video using yt-dlp.
    
    Returns the duration of the audio in seconds.
    """
    try:
        import yt_dlp
    except ImportError:
        raise ImportError("yt-dlp is required. Install with: pip install yt-dlp")
    
    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "outtmpl": output_path.replace(".mp3", ""),
        "quiet": True,
        "no_warnings": True,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return info.get("duration", 0)


def apply_vad(audio_path: str) -> bytes:
    """Apply Voice Activity Detection to remove silent segments.
    
    Uses webrtcvad or silero-vad if available, otherwise returns original audio.
    """
    try:
        # Try using pydub for simple silence-based VAD
        from pydub import AudioSegment
        from pydub.silence import detect_nonsilent
        
        audio = AudioSegment.from_file(audio_path)
        
        # Detect non-silent ranges (min silence length: 300ms, silence threshold: -40dB)
        non_silent_ranges = detect_nonsilent(audio, min_silence_len=300, silence_thresh=-40)
        
        if not non_silent_ranges:
            # If no speech detected, return original audio
            with open(audio_path, "rb") as f:
                return f.read()
        
        # Concatenate non-silent segments
        speech_segments = []
        for start, end in non_silent_ranges:
            speech_segments.append(audio[start:end])
        
        if speech_segments:
            # Concatenate non-silent segments with padding
            padding = AudioSegment.silent(duration=100)  # 100ms padding
            final_audio = AudioSegment.empty()
            for i, segment in enumerate(speech_segments):
                if i > 0:
                    final_audio += padding
                final_audio += segment
            
            # Export to bytes
            buffer = io.BytesIO()
            final_audio.export(buffer, format="mp3")
            return buffer.getvalue()
        
    except ImportError:
        # pydub not available, return original audio
        pass
    
    # Fallback: return original audio
    with open(audio_path, "rb") as f:
        return f.read()


def transcribe_with_fireworks_whisper(audio_bytes: bytes, filename: str = "audio.mp3") -> str:
    """Transcribe audio using Fireworks AI Whisper V3 Turbo."""
    # Read API credentials at runtime (after load_dotenv has been called)
    api_key = os.getenv("FIREWORKS_API_KEY")
    # Audio API uses different endpoint than chat completions
    # whisper-v3: https://audio-prod.api.fireworks.ai/v1
    # whisper-v3-turbo: https://audio-turbo.api.fireworks.ai/v1
    base_url = AUDIO_API_BASE_URL
    
    if not api_key:
        raise ValueError("FIREWORKS_API_KEY environment variable not set")
    
    client = OpenAI(
        api_key=api_key,
        base_url=base_url
    )
    
    # Create a temporary file for the audio
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    
    try:
        with open(tmp_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=audio_file,
                response_format="text",
                # Enable VAD via the timestamp_granularities option if available
            )
        return response
    finally:
        os.unlink(tmp_path)


def process_youtube_url(url: str) -> TranscriptionResult:
    """Process a YouTube URL: download audio, apply VAD, transcribe with Whisper.
    
    Args:
        url: YouTube video URL
        
    Returns:
        TranscriptionResult containing transcript, duration, and word count
    """
    # Extract video ID for logging
    video_id = extract_youtube_id(url)
    if not video_id:
        raise ValueError(f"Invalid YouTube URL: {url}")
    
    # Create temporary directory for processing
    with tempfile.TemporaryDirectory() as temp_dir:
        audio_path = os.path.join(temp_dir, "audio.mp3")
        
        # Download audio
        duration = download_youtube_audio(url, audio_path)
        
        # Apply VAD to remove silence
        audio_bytes = apply_vad(audio_path)
        
        # Transcribe with Fireworks Whisper V3 Turbo
        transcript = transcribe_with_fireworks_whisper(audio_bytes, f"{video_id}.mp3")
        
        # Calculate word count
        word_count = len(transcript.split())
        
        return TranscriptionResult(
            text=transcript,
            duration_seconds=duration,
            word_count=word_count
        )


def ingest_youtube_video(url: str) -> IngestResponse:
    """Main ingestion function for YouTube videos.
    
    Args:
        url: YouTube video URL
        
    Returns:
        IngestResponse with success status, transcript, and metadata
    """
    try:
        result = process_youtube_url(url)
        
        return IngestResponse(
            success=True,
            message=f"Successfully transcribed {result.word_count} words from {result.duration_seconds:.1f}s of audio",
            transcript=result.text,
            duration_seconds=result.duration_seconds,
            word_count=result.word_count
        )
    except Exception as e:
        return IngestResponse(
            success=False,
            message=f"Ingestion failed: {str(e)}"
        )
