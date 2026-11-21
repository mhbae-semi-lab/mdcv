"""Encryption at rest for OAuth tokens and mail bodies: AES-256-GCM (cryptography package).

Key: MDCV_SECRET (any length; stretched with scrypt), or else a random 32-byte key file (mdcv.key) created next to
the DB. Back up the key file together with the DB: without it nothing can be decrypted.
Format "v3:" + base64(12-byte nonce + ciphertext + 16-byte tag). Values written by earlier versions — v2 (HMAC
keystream) and v1 (fixed XOR) — are still readable so Store can re-encrypt them once at startup (migrate_value).
"""
import base64
import hashlib
import hmac
import os
import secrets
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PLACEHOLDER = ("", "change-me-in-production", "mdcv-local-secret")
LEGACY_SECRET = "mdcv-local-secret"
PREFIX = "v3:"
AAD = b"mdcv"


def key_file():
    db = os.getenv("MDCV_DB")
    folder = os.path.dirname(os.path.abspath(db)) if db else os.path.join(os.path.dirname(__file__), "..")
    return os.getenv("MDCV_KEY_FILE") or os.path.join(folder, "mdcv.key")


def _secret():
    env = os.getenv("MDCV_SECRET", "")
    if env not in PLACEHOLDER:
        return env.encode()
    path = key_file()
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(secrets.token_bytes(32))
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    with open(path, "rb") as f:
        return f.read()


@lru_cache(maxsize=4)
def _aes_key(secret):
    return hashlib.scrypt(secret, salt=b"mdcv-aesgcm-v3", n=2 ** 14, r=8, p=1, dklen=32)


def encrypt(text):
    if not text:
        return ""
    nonce = secrets.token_bytes(12)
    return PREFIX + base64.b64encode(nonce + AESGCM(_aes_key(_secret())).encrypt(nonce, text.encode(), AAD)).decode()


def is_current(value):
    return not value or value.startswith(PREFIX)


def decrypt(text):
    if not text:
        return ""
    if text.startswith(PREFIX):
        blob = base64.b64decode(text[3:].encode())
        try:
            return AESGCM(_aes_key(_secret())).decrypt(blob[:12], blob[12:], AAD).decode()
        except Exception:
            raise ValueError("암호문이 변조됐거나 비밀값(MDCV_SECRET/mdcv.key)이 바뀌었습니다. 계정을 다시 연결하세요.")
    if text.startswith("v2:"):
        return _v2(text)
    return _v1(text)


def migrate_value(value):
    """Re-encrypts a v1/v2 value as v3. Returns None when it is already current."""
    return None if is_current(value) else encrypt(decrypt(value))


# --- legacy formats (read only) ----------------------------------------------------------------------------------------
@lru_cache(maxsize=4)
def _v2_keys(secret):
    raw = hashlib.scrypt(secret, salt=b"mdcv-token-v2", n=2 ** 14, r=8, p=1, dklen=64)
    return raw[:32], raw[32:]


def _v2(text):
    blob = base64.b64decode(text[3:].encode())
    nonce, body, tag = blob[:16], blob[16:-32], blob[-32:]
    enc_key, mac_key = _v2_keys(_secret())
    if not hmac.compare_digest(tag, hmac.new(mac_key, nonce + body, hashlib.sha256).digest()):
        raise ValueError("토큰이 변조됐거나 비밀값(MDCV_SECRET/mdcv.key)이 바뀌었습니다. 계정을 다시 연결하세요.")
    stream, counter = b"", 0
    while len(stream) < len(body):
        stream += hmac.new(enc_key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(a ^ b for a, b in zip(body, stream)).decode()


def _v1(text):
    for secret in (os.getenv("MDCV_SECRET", LEGACY_SECRET), LEGACY_SECRET):
        key = hashlib.sha256(secret.encode()).digest()
        raw = base64.b64decode(text.encode())
        try:
            return bytes(b ^ key[i % len(key)] for i, b in enumerate(raw)).decode()
        except UnicodeDecodeError:
            continue
    raise ValueError("토큰을 복호화할 수 없습니다")
