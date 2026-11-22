from fastapi import APIRouter

from ..deps import Provider
from ..schemas import AppConfig, Health

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health", response_model=Health, summary="Liveness check")
def health() -> dict:
    return {"status": "ok"}


@router.get("/config", response_model=AppConfig, summary="Editable settings (data/config.json)")
def get_config(provider: Provider) -> dict:
    return provider.config()
