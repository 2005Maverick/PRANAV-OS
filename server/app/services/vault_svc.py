"""Password-protected vault.

- Key = scrypt(password, salt). Server stores only salt + SHA-256 verifier of
  the key — never the password, never the key.
- Secrets encrypted AES-GCM with the derived key; decryption happens only in a
  request that carries the correct password.
- The bot never sees secrets: it serves pointer entries only.
"""
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .. import db

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt,
                          n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)


async def has_password() -> bool:
    return bool(await db.get_setting("vault_salt"))


async def setup(password: str) -> str:
    if await has_password():
        return "Vault password already set."
    if len(password) < 8:
        return "Use at least 8 characters."
    salt = os.urandom(16)
    key = _derive(password, salt)
    await db.set_setting("vault_salt", salt.hex())
    await db.set_setting("vault_verifier", hashlib.sha256(key).hexdigest())
    return "ok"


async def _key_for(password: str) -> bytes | None:
    salt_hex = await db.get_setting("vault_salt")
    verifier = await db.get_setting("vault_verifier")
    if not salt_hex or not verifier:
        return None
    key = _derive(password, bytes.fromhex(salt_hex))
    if hashlib.sha256(key).hexdigest() != verifier:
        return None
    return key


async def add(password: str, label: str, pointer: str | None, secret: str | None) -> str:
    key = await _key_for(password)
    if key is None:
        return "wrong password"
    if secret:
        nonce = os.urandom(12)
        ct = AESGCM(key).encrypt(nonce, secret.encode(), None)
        await db.execute(
            "INSERT INTO vault_entries (label, kind, pointer, ciphertext, nonce) "
            "VALUES ($1,'encrypted',$2,$3,$4)", label[:120], pointer, ct, nonce)
    else:
        await db.execute(
            "INSERT INTO vault_entries (label, kind, pointer) VALUES ($1,'pointer',$2)",
            label[:120], pointer)
    return "ok"


async def unlock(password: str) -> list[dict] | None:
    key = await _key_for(password)
    if key is None:
        return None
    rows = await db.fetch(
        "SELECT id, label, kind, pointer, ciphertext, nonce FROM vault_entries ORDER BY id")
    out = []
    for r in rows:
        secret = None
        if r["kind"] == "encrypted" and r["ciphertext"]:
            try:
                secret = AESGCM(key).decrypt(bytes(r["nonce"]), bytes(r["ciphertext"]), None).decode()
            except Exception:
                secret = "(decryption failed)"
        out.append({"id": r["id"], "label": r["label"], "kind": r["kind"],
                    "pointer": r["pointer"], "secret": secret})
        await db.execute(
            "INSERT INTO vault_access_log (entry_id, surface) VALUES ($1,'cockpit')", r["id"])
    return out


async def pointers(query: str) -> str:
    """Bot-safe lookup: labels + pointers only, never decrypted values."""
    rows = await db.fetch(
        "SELECT label, kind, pointer FROM vault_entries "
        "WHERE label ILIKE '%'||$1||'%' ORDER BY id LIMIT 5", query)
    if not rows:
        return f"Nothing in the vault matching “{query}”."
    lines = []
    for r in rows:
        if r["pointer"]:
            lines.append(f"• {r['label']} → {r['pointer']}")
        else:
            lines.append(f"• {r['label']} — locked; open the cockpit Vault to view")
    return "\n".join(lines)
