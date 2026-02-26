"""
FastAPI web server — serves the dashboard and API endpoints.
"""

import json
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import database

logger = logging.getLogger(__name__)

app = FastAPI(title="BankrBot Alert Dashboard")

# Serve static files
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    """Serve the main dashboard page."""
    html_path = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=html_path.read_text())


@app.get("/api/stats")
async def api_stats():
    """Dashboard statistics."""
    stats = await database.get_stats()
    return JSONResponse(content=stats)


@app.get("/api/deployments")
async def api_deployments(limit: int = 50, offset: int = 0, alerted_only: bool = False):
    """Get deployment records with profile info."""
    rows = await database.get_deployments(limit=limit, offset=offset, alerted_only=alerted_only)
    # Parse JSON fields for the frontend
    for row in rows:
        for field in ("key_followers", "bio_keyword_matches", "score_breakdown"):
            if row.get(field) and isinstance(row[field], str):
                try:
                    row[field] = json.loads(row[field])
                except (json.JSONDecodeError, TypeError):
                    pass
    return JSONResponse(content=rows)


@app.get("/api/profile/{username}")
async def api_profile(username: str):
    """Get profile analysis for a specific username."""
    profile = await database.get_profile(username)
    if not profile:
        return JSONResponse(content={"error": "Profile not found"}, status_code=404)
    for field in ("key_followers", "bio_keyword_matches", "score_breakdown"):
        if profile.get(field) and isinstance(profile[field], str):
            try:
                profile[field] = json.loads(profile[field])
            except (json.JSONDecodeError, TypeError):
                pass
    return JSONResponse(content=profile)
