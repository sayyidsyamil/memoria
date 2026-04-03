"""FastAPI ASGI entry — mounts Memoria Brain routes from ``brain.chat``."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from brain.chat import router as brain_router

app = FastAPI(title="Memoria Brain API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(brain_router)
