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
    """Download audio from YouTube video using yt-dlp with multiple fallback strategies."""
    try:
        import yt_dlp
    except ImportError:
        raise ImportError("yt-dlp is required. Install with: pip install yt-dlp")
    
    # Try multiple format options and configurations
    attempts = [
        # Attempt 1: Best audio with standard settings
        {
            "format": "bestaudio/best",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        },
        # Attempt 2: Try with any available audio format
        {
            "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        },
        # Attempt 3: Worst audio quality (most likely to be available)
        {
            "format": "worstaudio",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }],
        },
        # Attempt 4: Any video format and extract audio
        {
            "format": "worst[ext=mp4]/worst",
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }],
        },
        # Attempt 5: Try without postprocessors (raw download)
        {
            "format": "bestaudio",
            "postprocessors": [],
        },
    ]
    
    last_error = None
    
    for i, opts in enumerate(attempts, 1):
        ydl_opts = {
            **opts,
            "outtmpl": output_path.replace(".mp3", "") if opts.get("postprocessors") else output_path.replace(".mp3", ".%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "cookiesfrombrowser": None,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info:
                    # Handle case where we didn't use postprocessors
                    if not opts.get("postprocessors"):
                        downloaded_ext = info.get("ext", "webm")
                        downloaded_path = output_path.replace(".mp3", f".{downloaded_ext}")
                        # Convert to mp3 manually if needed
                        if downloaded_path != output_path and os.path.exists(downloaded_path):
                            try:
                                from pydub import AudioSegment
                                audio = AudioSegment.from_file(downloaded_path)
                                audio.export(output_path, format="mp3")
                                os.remove(downloaded_path)
                            except:
                                # If conversion fails, just use the original file
                                os.rename(downloaded_path, output_path)
                    return info.get("duration", 0)
        except Exception as e:
            last_error = e
            error_msg = str(e).lower()
            
            # Check for specific errors that warrant trying again
            if any(x in error_msg for x in ["format", "unavailable", "403", "forbidden", "sign in"]):
                print(f"Download attempt {i} failed with format error, trying fallback...")
                continue
            
            # For other errors, raise immediately
            raise
    
        # If all attempts failed, provide helpful error message
        if last_error:
            error_msg = str(last_error).lower()
            if "403" in error_msg or "forbidden" in error_msg:
                raise ValueError(
                    "YouTube is blocking the download (403 Forbidden). "
                    "This typically means:\n"
                    "1. The video is age-restricted\n"
                    "2. The video requires sign-in\n"
                    "3. The video is region-restricted\n"
                    "4. YouTube has updated their anti-bot measures\n\n"
                    "Solutions:\n"
                    "1. Update yt-dlp: pip install -U yt-dlp\n"
                    "2. Try a different video (preferably one without restrictions)\n"
                    "3. If this is your own video, make sure it's public (not private/unlisted)\n"
                    "4. Wait a few minutes and try again"
                )
            elif "unavailable" in error_msg or "not available" in error_msg:
                raise ValueError(
                    "Video format not available. The video may be:\n"
                    "1. Removed or deleted by the creator\n"
                    "2. Region-restricted in your location\n"
                    "3. Using a new YouTube format not yet supported\n\n"
                    "Try a different video."
                )
            raise last_error
        
        raise ValueError("Could not download audio with any available format")


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
                source_id,
                [e.to_dict() for e in result.entities],
                [r.to_dict() for r in result.relationships]
            )
            print(f"Extraction completed for source {source_id}: {len(result.entities)} entities, {len(result.relationships)} relationships (quality: {result.quality_score})")
        except Exception as e:
            import traceback
            print(f"Extraction failed for source {source_id}: {e}")
            print(traceback.format_exc())
    
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
        
        # Download and get info in one step
        try:
            import yt_dlp
            ydl_opts = {
                "format": "bestaudio/best",
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }],
                "outtmpl": audio_path.replace(".mp3", ""),
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                duration = info.get("duration", 0)
                title = info.get("title", f"YouTube Video ({video_id})")
        except Exception as e:
            error_msg = str(e).lower()
            if "unavailable" in error_msg or "not available" in error_msg:
                raise ValueError(
                    "Video format not available. This video may be:\n"
                    "1. Age-restricted\n"
                    "2. Region-blocked\n" 
                    "3. Requires authentication\n"
                    "4. Using a format not supported by current yt-dlp\n\n"
                    "Try: pip install -U yt-dlp"
                )
            raise
        
        audio_bytes = apply_vad(audio_path)
        transcript = transcribe_with_fireworks_whisper(audio_bytes, f"{video_id}.mp3")
        word_count = len(transcript.split())
        
        source_id = save_source(
            url=url,
            title=title,
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
