"""Accounts: register, login (JWT), current user (ARCHITECTURE.md section 14)."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(examples=["farmer.kebili@demo.tn"])
    password: str = Field(examples=["demo1234"])


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, examples=["Ali Ben Salah"])
    email: str = Field(examples=["ali@example.tn"])
    password: str = Field(min_length=6, examples=["monmotdepasse"])
    language: str = "fr"


@router.post("/register", status_code=201, summary="Create a farmer account and sign in")
def register(body: RegisterIn) -> dict:
    user = auth.register(body.email, body.name, body.password, body.language)
    return auth.issue_token(user)


@router.post("/login", summary="Email + password -> JWT and user profile")
def login(body: LoginIn) -> dict:
    return auth.issue_token(auth.authenticate(body.email, body.password))


@router.get("/me", summary="Current user")
def me(user: auth.CurrentUser) -> dict:
    return auth.public(user)
