"""YouTube audio ingestion and transcription module using Fireworks AI Whisper V3 Turbo."""

import os
import re
import io
import tempfile
import threading
from typing import Optional
from dataclasses import dataclass

from pydantic import BaseModel
from openai import OpenAI

from .database import init_database, save_source, update_source_extraction, DB_PATH
from .extraction import extract_entities_from_transcript


WHISPER_MODEL = "whisper-v3-turbo"
AUDIO_API_BASE_URL = "https://audio-turbo.api.fireworks.ai/v1"


class IngestRequest(BaseModel):
    url: str


class IngestResponse(BaseModel):
    success: bool
    message: str
    source_id: Optional[int] = None
    transcript: Optional[str] = None
    duration_seconds: Optional[float] = None
    word_count: Optional[int] = None
    extraction_status: str = "pending"


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
    """Download audio from YouTube video using yt-dlp."""
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
    """Apply Voice Activity Detection to remove silent segments."""
    try:
        from pydub import AudioSegment
        from pydub.silence import detect_nonsilent
        
        audio = AudioSegment.from_file(audio_path)
        non_silent_ranges = detect_nonsilent(audio, min_silence_len=300, silence_thresh=-40)
        
        if not non_silent_ranges:
            with open(audio_path, "rb") as f:
                return f.read()
        
        speech_segments = []
        for start, end in non_silent_ranges:
            speech_segments.append(audio[start:end])
        
        if speech_segments:
            padding = AudioSegment.silent(duration=100)
            final_audio = AudioSegment.empty()
            for i, segment in enumerate(speech_segments):
                if i > 0:
                    final_audio += padding
                final_audio += segment
            
            buffer = io.BytesIO()
            final_audio.export(buffer, format="mp3")
            return buffer.getvalue()
        
    except ImportError:
        pass
    
    with open(audio_path, "rb") as f:
        return f.read()


def transcribe_with_fireworks_whisper(audio_bytes: bytes, filename: str = "audio.mp3") -> str:
    """Transcribe audio using Fireworks AI Whisper V3 Turbo."""
    api_key = os.getenv("FIREWORKS_API_KEY")
    base_url = AUDIO_API_BASE_URL
    
    if not api_key:
        raise ValueError("FIREWORKS_API_KEY environment variable not set")
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    
    try:
        with open(tmp_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=audio_file,
                response_format="text",
            )
        return response
    finally:
        os.unlink(tmp_path)


def run_extraction_async(source_id: int, transcript: str):
    """Run entity extraction in background thread."""
    def extract():
        try:
            result = extract_entities_from_transcript(transcript)
            update_source_extraction(
                DB_PATH,
                source_id,
                result["entities"],
                result["relationships"]
            )
            print(f"Extraction completed for source {source_id}: {len(result['entities'])} entities, {len(result['relationships'])} relationships")
        except Exception as e:
            print(f"Extraction failed for source {source_id}: {e}")
    
    thread = threading.Thread(target=extract, daemon=True)
    thread.start()


def process_youtube_url(url: str) -> tuple[TranscriptionResult, int]:
    """Process a YouTube URL: download, transcribe, save to DB, start extraction."""
    init_database(DB_PATH)
    
    video_id = extract_youtube_id(url)
    if not video_id:
        raise ValueError(f"Invalid YouTube URL: {url}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        audio_path = os.path.join(temp_dir, "audio.mp3")
        
        duration = download_youtube_audio(url, audio_path)
        audio_bytes = apply_vad(audio_path)
        transcript = transcribe_with_fireworks_whisper(audio_bytes, f"{video_id}.mp3")
        word_count = len(transcript.split())
        
        source_id = save_source(
            DB_PATH,
            url=url,
            title=f"YouTube Video ({video_id})",
            transcript=transcript,
            duration_seconds=duration,
            word_count=word_count
        )
        
        run_extraction_async(source_id, transcript)
        
        return TranscriptionResult(
            text=transcript,
            duration_seconds=duration,
            word_count=word_count
        ), source_id


def ingest_youtube_video(url: str) -> IngestResponse:
    """Main ingestion function for YouTube videos."""
    try:
        result, source_id = process_youtube_url(url)
        
        return IngestResponse(
            success=True,
            message=f"Successfully transcribed {result.word_count} words. Review in Graph →",
            source_id=source_id,
            transcript=result.text[:500] + "..." if len(result.text) > 500 else result.text,
            duration_seconds=result.duration_seconds,
            word_count=result.word_count,
            extraction_status="pending"
        )
    except Exception as e:
        return IngestResponse(
            success=False,
            message=f"Ingestion failed: {str(e)}"
        )
