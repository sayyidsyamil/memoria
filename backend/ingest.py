"""Content ingestion module for YouTube videos, PDFs, and web pages.

Provides:
  ingest_youtube()    — fetch transcript and generate structured notes
  ingest_pdf()        — extract text and generate structured notes
  ingest_webpage()    — fetch and extract text from web pages
  generate_notes()    — use AI to create structured notes from content
"""
from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse, parse_qs, unquote

import httpx


@dataclass
class IngestResult:
    """Result of ingesting content."""
    source_type: Literal["youtube", "pdf", "webpage"]
    source_url: str
    title: str
    transcript: str  # Full raw transcript/text
    summary: str
    key_points: list[str]
    tags: list[str]
    raw_content: str  # For knowledge inspector


def _extract_youtube_id(url: str) -> str | None:
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    # Try parsing as query param
    parsed = urlparse(url)
    if 'youtube.com' in parsed.netloc:
        qs = parse_qs(parsed.query)
        if 'v' in qs:
            return qs['v'][0]
    return None


def _fetch_youtube_metadata(video_id: str) -> dict:
    """Fetch video metadata using oEmbed."""
    try:
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        r = httpx.get(oembed_url, timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return {"title": f"YouTube Video {video_id}"}


def ingest_youtube(url: str, config: dict | None = None) -> IngestResult:
    """Fetch YouTube transcript and generate structured notes.
    
    Args:
        url: YouTube video URL
        config: Optional config dict with model settings
        
    Returns:
        IngestResult with transcript, summary, and key points
    """
    video_id = _extract_youtube_id(url)
    if not video_id:
        raise ValueError(f"Could not extract video ID from URL: {url}")
    
    # Import here to avoid dependency issues if not installed
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        raise ImportError("youtube-transcript-api not installed. Run: pip install youtube-transcript-api")
    
    # Fetch transcript - try multiple strategies
    ytt_api = YouTubeTranscriptApi()
    fetched = None
    
    try:
        # First, list available transcripts
        transcript_list = ytt_api.list(video_id)
        
        # Try to find English first (manual preferred, then generated)
        for lang in ['en', 'en-US', 'en-GB']:
            try:
                transcript_obj = transcript_list.find_transcript([lang])
                fetched = transcript_obj.fetch()
                break
            except Exception:
                continue
        
        # If no English, try any manual transcript
        if not fetched:
            for transcript in transcript_list:
                if not transcript.is_generated:
                    try:
                        fetched = transcript.fetch()
                        break
                    except Exception:
                        continue
        
        # If still no manual, use first available generated transcript
        if not fetched:
            for transcript in transcript_list:
                try:
                    fetched = transcript.fetch()
                    break
                except Exception:
                    continue
                    
    except Exception as e:
        # Fallback: try simple fetch which defaults to English
        try:
            fetched = ytt_api.fetch(video_id)
        except Exception:
            raise ValueError(f"Could not fetch transcript: {e}")
    
    if not fetched:
        raise ValueError("No transcript available for this video")
    
    # Combine transcript text
    full_text = " ".join([snippet.text for snippet in fetched])
    
    # Get metadata
    metadata = _fetch_youtube_metadata(video_id)
    title = metadata.get("title", f"YouTube Video {video_id}")
    
    # Generate structured notes using AI
    return _generate_notes(
        source_type="youtube",
        source_url=url,
        title=title,
        content=full_text,
        config=config,
    )


def ingest_pdf(file_path: str, config: dict | None = None) -> IngestResult:
    """Extract text from PDF and generate structured notes.
    
    Args:
        file_path: Path to PDF file
        config: Optional config dict with model settings
        
    Returns:
        IngestResult with extracted text, summary, and key points
    """
    # Import here to avoid dependency issues if not installed
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ImportError("PyMuPDF not installed. Run: pip install pymupdf")
    
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF file not found: {file_path}")
    
    # Extract text from PDF
    doc = fitz.open(file_path)
    full_text = ""
    for page in doc:
        full_text += page.get_text()
    doc.close()
    
    if not full_text.strip():
        raise ValueError("No text content found in PDF (may be image-based)")
    
    # Use filename as fallback title
    title = path.stem.replace("_", " ").replace("-", " ").title()
    
    # Generate structured notes using AI
    return _generate_notes(
        source_type="pdf",
        source_url=file_path,
        title=title,
        content=full_text,
        config=config,
    )


def _generate_notes(
    source_type: Literal["youtube", "pdf"],
    source_url: str,
    title: str,
    content: str,
    config: dict | None = None,
) -> IngestResult:
    """Use AI to generate structured notes from content."""
    cfg = config or {}
    
    # Truncate if too long
    max_chars = 15000
    truncated = content[:max_chars]
    if len(content) > max_chars:
        truncated += "\n\n[Content truncated due to length...]"
    
    # Build prompt for structured notes
    system_prompt = """You are a knowledge extraction assistant. Your task is to analyze content and create structured notes.

Given content from a source, create:
1. A concise summary (2-4 sentences)
2. 5-10 key points (bullet points)
3. 3-5 relevant tags (short keywords)

Format your response exactly as follows:

SUMMARY:
[summary text]

KEY POINTS:
- point 1
- point 2
...

TAGS:
tag1, tag2, tag3...

Be concise and extract the most important insights."""

    user_prompt = f"""Source: {source_type.upper()}
Title: {title}

Content:
{truncated}

Create structured notes following the format above."""

    # Call AI to generate notes
    from providers import stream, AssistantTurn
    
    messages = [{"role": "user", "content": user_prompt}]
    
    result_text = ""
    for event in stream(
        model=cfg.get("model", "accounts/fireworks/routers/kimi-k2p5-turbo"),
        system=system_prompt,
        messages=messages,
        tool_schemas=[],
        config={**cfg, "max_tokens": 2048, "no_tools": True},
    ):
        if isinstance(event, AssistantTurn):
            result_text = event.text
            break
    
    # Parse the result
    summary = ""
    key_points = []
    tags = []
    
    # Extract sections
    if "SUMMARY:" in result_text:
        summary_match = re.search(r'SUMMARY:(.+?)(?=KEY POINTS:|$)', result_text, re.DOTALL)
        if summary_match:
            summary = summary_match.group(1).strip()
    
    if "KEY POINTS:" in result_text:
        kp_match = re.search(r'KEY POINTS:(.+?)(?=TAGS:|$)', result_text, re.DOTALL)
        if kp_match:
            kp_text = kp_match.group(1).strip()
            key_points = [line.lstrip('- ').strip() for line in kp_text.split('\n') if line.strip()]
    
    if "TAGS:" in result_text:
        tags_match = re.search(r'TAGS:(.+?)(?:\n\n|$)', result_text, re.DOTALL)
        if tags_match:
            tags_text = tags_match.group(1).strip()
            tags = [t.strip() for t in tags_text.split(',') if t.strip()]
    
    # Fallback if parsing failed
    if not summary:
        summary = result_text[:400] if result_text else "No summary generated"
    if not key_points:
        key_points = ["See full content for details"]
    if not tags:
        tags = [source_type, "notes"]
    
    return IngestResult(
        source_type=source_type,
        source_url=source_url,
        title=title,
        transcript=content,
        summary=summary,
        key_points=key_points[:10],  # Limit to 10
        tags=tags[:5],  # Limit to 5
        raw_content=result_text,
    )


def download_pdf(url: str, temp_dir: str | None = None) -> str:
    """Download PDF from URL to temp file.
    
    Returns:
        Path to downloaded PDF file
    """
    temp_dir = temp_dir or tempfile.gettempdir()
    
    # Extract filename from URL or use default
    parsed = urlparse(url)
    filename = Path(parsed.path).name or "document.pdf"
    if not filename.endswith('.pdf'):
        filename += '.pdf'
    
    temp_path = Path(temp_dir) / f"memoria_{filename}"
    
    # Download
    r = httpx.get(url, follow_redirects=True, timeout=60)
    r.raise_for_status()
    
    temp_path.write_bytes(r.content)
    return str(temp_path)


def ingest_webpage(url: str, config: dict | None = None) -> IngestResult:
    """Fetch webpage content and generate structured notes.
    
    Args:
        url: Web page URL (any website)
        config: Optional config dict with model settings
        
    Returns:
        IngestResult with extracted text, summary, and key points
    """
    # Special handling for Wikipedia - use REST API
    if 'wikipedia.org' in url or 'wikipedia.' in url:
        return _ingest_wikipedia(url, config)
    
    # Fetch the webpage
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        "DNT": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "max-age=0",
    }
    
    r = httpx.get(url, headers=headers, follow_redirects=True, timeout=30)
    r.raise_for_status()
    
    # Try to extract title
    title = url
    html = r.text
    title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
    if title_match:
        title = title_match.group(1).strip()
    
    # Extract text content from HTML
    full_text = _extract_text_from_html(html, url)
    
    if not full_text.strip():
        raise ValueError("No text content could be extracted from this webpage")
    
    # Generate structured notes using AI
    return _generate_notes(
        source_type="webpage",
        source_url=url,
        title=title,
        content=full_text,
        config=config,
    )


def _ingest_wikipedia(url: str, config: dict | None = None) -> IngestResult:
    """Special ingestion for Wikipedia using the REST API.
    
    Wikipedia blocks scrapers, so we use their official API instead.
    """
    # Extract article title from URL
    parsed = urlparse(url)
    path = parsed.path
    
    # Get the article title from /wiki/Title
    if '/wiki/' in path:
        article_title = path.split('/wiki/')[-1]
    else:
        # Try to extract from the last part of path
        article_title = path.split('/')[-1]
    
    # URL decode the title (unquote already imported at top of file)
    article_title = unquote(article_title)
    
    # Determine language from subdomain
    lang = parsed.netloc.split('.')[0]
    if lang == 'en':
        lang = 'en'
    
    # Use Wikipedia REST API
    api_url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{article_title}"
    
    headers = {
        "User-Agent": "Memoria/1.0 (research tool; memoria@example.com)"
    }
    
    r = httpx.get(api_url, headers=headers, follow_redirects=True, timeout=30)
    r.raise_for_status()
    data = r.json()
    
    # Get full content using the mobile-sections endpoint for more detail
    content_url = f"https://{lang}.wikipedia.org/api/rest_v1/page/mobile-sections/{article_title}"
    content_r = httpx.get(content_url, headers=headers, follow_redirects=True, timeout=30)
    
    full_text = ""
    if content_r.status_code == 200:
        content_data = content_r.json()
        # Extract text from sections
        sections = content_data.get('remaining', {}).get('sections', [])
        for section in sections:
            full_text += section.get('text', '') + "\n\n"
    
    # Use extract from summary if full content failed
    if not full_text:
        full_text = data.get('extract', '')
    
    title = data.get('title', article_title)
    description = data.get('description', '')
    
    # Prepend description if available
    if description:
        full_text = f"{description}\n\n{full_text}"
    
    if not full_text.strip():
        raise ValueError("Could not extract content from Wikipedia")
    
    return _generate_notes(
        source_type="webpage",
        source_url=url,
        title=title,
        content=full_text,
        config=config,
    )


def _extract_text_from_html(html: str, url: str) -> str:
    """Extract readable text from HTML, handling common site types."""
    # Remove script and style tags first
    html = re.sub(r'<script[^>]*>[\s\S]*?</script>', ' ', html, flags=re.IGNORECASE)
    html = re.sub(r'<style[^>]*>[\s\S]*?</style>', ' ', html, flags=re.IGNORECASE)
    html = re.sub(r'<noscript[^>]*>[\s\S]*?</noscript>', ' ', html, flags=re.IGNORECASE)
    html = re.sub(r'<!--[\s\S]*?-->', ' ', html)
    
    # Special handling for Wikipedia
    if 'wikipedia.org' in url or 'wikipedia.' in url:
        # Extract main content
        content_match = re.search(r'<div[^>]*id=["\']mw-content-text["\'][^>]*>([\s\S]*?)<div[^>]*class=["\']catlinks["\']', html)
        if content_match:
            html = content_match.group(1)
        # Remove infobox
        html = re.sub(r'<table[^>]*class=["\'][^"\']*infobox[^"\']*["\'][^>]*>[\s\S]*?</table>', ' ', html, flags=re.IGNORECASE)
        # Remove edit links
        html = re.sub(r'<span[^>]*class=["\']mw-editsection["\'][^>]*>[\s\S]*?</span>', ' ', html, flags=re.IGNORECASE)
    
    # Special handling for common article sites (Medium, Substack, etc.)
    # Look for article/main content
    article_patterns = [
        r'<article[^>]*>([\s\S]*?)</article>',
        r'<main[^>]*>([\s\S]*?)</main>',
        r'<div[^>]*class=["\'][^"\']*(?:content|article|post|entry|main)[^"\']*["\'][^>]*>([\s\S]*?)</div>',
    ]
    
    for pattern in article_patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            html = match.group(1)
            break
    
    # Convert common block elements to newlines
    html = re.sub(r'</(p|div|h[1-6]|li|tr|section|article)>', '\n', html, flags=re.IGNORECASE)
    html = re.sub(r'<br\s*/?>', '\n', html, flags=re.IGNORECASE)
    html = re.sub(r'</(td|th)>', ' ', html, flags=re.IGNORECASE)
    
    # Remove remaining HTML tags
    text = re.sub(r'<[^>]+>', ' ', html)
    
    # Clean up whitespace
    text = re.sub(r'\n\s*\n', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = '\n'.join(line.strip() for line in text.split('\n'))
    
    # Remove very short lines that are likely navigation
    lines = [line for line in text.split('\n') if len(line.strip()) > 2]
    
    return '\n'.join(lines).strip()
