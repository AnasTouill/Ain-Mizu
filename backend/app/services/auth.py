"""Accounts (ARCHITECTURE.md 13.10 / 14): data/users.json, bcrypt password hashes, JWT bearer tokens.

Flat-file store (no database, section 12.1). Writes are atomic (temp file + replace) and guarded
by a lock, so run a single worker.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Annotated, Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..config import DATA_DIR

USERS_FILE = DATA_DIR / "users.json"
SECRET_FILE = DATA_DIR / ".jwt_secret"
ALGO = "HS256"
EXPIRE_MIN = 480
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_lock = threading.RLock()
_bearer = HTTPBearer(auto_error=False)

DEMO_PASSWORD = "demo1234"
DEMO_USERS = [
    ("u_001", "farmer.kebili@demo.tn", "Ali Ben Salah", "kebili"),
    ("u_002", "farmer.kairouan@demo.tn", "Fatma Trabelsi", "kairouan"),
    ("u_003", "farmer.sidibouzid@demo.tn", "Hedi Mansouri", "sidi_bouzid"),
]


def _secret() -> str:
    env = os.environ.get("PHYSARUM_JWT_SECRET")
    if env:
        return env
    with _lock:
        if not SECRET_FILE.exists():
            SECRET_FILE.write_text(secrets.token_hex(32), encoding="utf-8")
        return SECRET_FILE.read_text(encoding="utf-8").strip()


def write_json_atomic(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("ascii")


def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def load_users() -> list[dict]:
    with _lock:
        if not USERS_FILE.exists():
            # seed the demo farmers of section 13.10 (no farm yet: they go through onboarding too)
            users = [{"user_id": uid, "email": email, "name": name, "password_hash": hash_password(DEMO_PASSWORD),
                      "role": "farmer", "farm_ids": [], "language": "fr", "zone_hint": zone,
                      "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")} for uid, email, name, zone in DEMO_USERS]
            write_json_atomic(USERS_FILE, users)
        return json.loads(USERS_FILE.read_text(encoding="utf-8"))


def save_users(users: list[dict]) -> None:
    with _lock:
        write_json_atomic(USERS_FILE, users)


def public(user: dict) -> dict:
    return {k: user.get(k) for k in ("user_id", "email", "name", "role", "language", "farm_ids")}


def find_by_email(email: str) -> dict | None:
    email = email.strip().lower()
    return next((u for u in load_users() if u["email"].lower() == email), None)


def register(email: str, name: str, password: str, language: str = "fr") -> dict:
    email = email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Adresse e-mail invalide")
    if len(password) < 6:
        raise HTTPException(422, "Le mot de passe doit contenir au moins 6 caractères")
    if not name.strip():
        raise HTTPException(422, "Le nom est obligatoire")
    with _lock:
        users = load_users()
        if any(u["email"].lower() == email for u in users):
            raise HTTPException(409, "Un compte existe déjà avec cet e-mail")
        n = max([int(u["user_id"].split("_")[1]) for u in users if u["user_id"].startswith("u_")] + [0]) + 1
        user = {"user_id": f"u_{n:03d}", "email": email, "name": name.strip(), "password_hash": hash_password(password),
                "role": "farmer", "farm_ids": [], "language": language,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        users.append(user)
        save_users(users)
    return user


def authenticate(email: str, password: str) -> dict:
    user = find_by_email(email)
    if not user or not check_password(password, user["password_hash"]):
        raise HTTPException(401, "E-mail ou mot de passe incorrect")
    return user


def issue_token(user: dict) -> dict:
    exp = int(time.time()) + EXPIRE_MIN * 60
    token = jwt.encode({"sub": user["user_id"], "exp": exp}, _secret(), algorithm=ALGO)
    return {"access_token": token, "token_type": "bearer", "expires_in": EXPIRE_MIN * 60, "user": public(user)}


def update_user(user_id: str, **changes: Any) -> dict:
    with _lock:
        users = load_users()
        for u in users:
            if u["user_id"] == user_id:
                u.update(changes)
                save_users(users)
                return u
    raise HTTPException(404, "Utilisateur inconnu")


def current_user(creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> dict:
    if creds is None:
        raise HTTPException(401, "Connexion requise", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(creds.credentials, _secret(), algorithms=[ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expirée, reconnectez-vous")
    except jwt.PyJWTError:
        raise HTTPException(401, "Jeton invalide")
    user = next((u for u in load_users() if u["user_id"] == payload.get("sub")), None)
    if user is None:
        raise HTTPException(401, "Utilisateur inconnu")
    return user


CurrentUser = Annotated[dict, Depends(current_user)]
