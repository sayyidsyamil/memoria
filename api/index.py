from typing import List
from pydantic import BaseModel
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request as FastAPIRequest
from fastapi.responses import StreamingResponse
from openai import OpenAI
import os
from .utils.prompt import ClientMessage, convert_to_openai_messages
from .utils.stream import patch_response_with_headers, stream_text
from .utils.tools import AVAILABLE_TOOLS, TOOL_DEFINITIONS


load_dotenv(".env")

app = FastAPI()


class Request(BaseModel):
    messages: List[ClientMessage]


FIREWORKS_API_KEY = os.getenv("FIREWORKS_API_KEY")
FIREWORKS_BASE_URL = os.getenv("FIREWORKS_BASE_URL", "https://api.fireworks.ai/inference/v1")
FIREWORKS_MODEL = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/routers/kimi-k2p5-turbo")


@app.post("/api/chat")
async def handle_chat_data(request: Request, protocol: str = Query('data')):
    messages = request.messages
    openai_messages = convert_to_openai_messages(messages)

    client = OpenAI(api_key=FIREWORKS_API_KEY, base_url=FIREWORKS_BASE_URL)
    response = StreamingResponse(
        stream_text(client, openai_messages, TOOL_DEFINITIONS, AVAILABLE_TOOLS, protocol, FIREWORKS_MODEL),
        media_type="text/event-stream",
    )
    return patch_response_with_headers(response, protocol)
