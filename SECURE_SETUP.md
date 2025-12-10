# Secure Setup Guide

This document summarises what changed and how to run the backend in a secure configuration for grading or production-style demos.

## 1. Password hashing & migration

- All new passwords now use bcrypt (`bcryptjs`). The work factor can be tuned with `BCRYPT_ROUNDS` (defaults to 12, valid range ≥10).
- Legacy AES-encrypted passwords are transparently upgraded the first time a user signs in, but you should run a bulk migration before the final demo:
  ```bash
  npm run migrate:passwords
  ```
  Ensure `MONGO_URL` and `SECRET` are available in the environment so legacy passwords can be decrypted.
- Newly created accounts (clients, admins, drivers, shipper applicants) all receive `passwordVersion = 2` metadata so you can verify the migration.

## 2. HTTPS configuration

The server can listen on both HTTP and HTTPS. HTTPS is optional until you provide certificates.

| Variable | Purpose |
| --- | --- |
| `HTTPS_ENABLED` | Set to `true` to enable the TLS listener. |
| `HTTPS_KEY_PATH` | Absolute or relative path to the private key (`.key`). |
| `HTTPS_CERT_PATH` | Absolute or relative path to the certificate (`.crt` or `.pem`). |
| `HTTPS_PASSPHRASE` | Optional passphrase if the key is encrypted. |
| `HTTPS_PORT` | (Default `3443`) Port for the HTTPS server. |

Example (self-signed, development only):
```powershell
# 1. Generate cert/key (PowerShell + OpenSSL)
openssl req -x509 -newkey rsa:2048 -nodes -keyout dev-key.pem -out dev-cert.pem -days 365 -subj /CN=localhost

# 2. Update .env
HTTPS_ENABLED=true
HTTPS_KEY_PATH=./dev-key.pem
HTTPS_CERT_PATH=./dev-cert.pem
HTTPS_PORT=3443
```
Start the server normally (`npm start`). You will now have:
- HTTP fallback on `http://localhost:3000` (for older clients).
- HTTPS endpoint on `https://localhost:3443` for grading.

## 3. Hardened middleware

- `helmet` is enabled globally (`contentSecurityPolicy` disabled to keep the existing admin dashboard working; adjust as needed).
- Configurable CORS:
  - Use `CORS_ORIGINS` for a comma-separated allow-list (defaults to local dev hosts).
  - Set `CORS_ALLOW_ALL=true` when using mobile apps without predictable origins (not recommended for production).
- Rate limiting: configurable via
  - `RATE_LIMIT_WINDOW_MINUTES` (default `15`).
  - `RATE_LIMIT_MAX` for `/api` + `/payment` (default `400`).
  - `AUTH_RATE_LIMIT_MAX` for sensitive auth endpoints (default `40`).

## 4. Verification checklist before grading

1. `npm install` (already adds `bcryptjs` + `helmet`).
2. Configure `.env` with:
   ```
   MONGO_URL=mongodb+srv://...
   JWT_SECRET=...
   SECRET=...              # Needed only while legacy passwords still exist
   CORS_ORIGINS=http://localhost:3000,http://localhost:5173
   HTTPS_ENABLED=true
   HTTPS_KEY_PATH=./dev-key.pem
   HTTPS_CERT_PATH=./dev-cert.pem
   ```
3. Run `npm run migrate:passwords` (once).
4. Start the server with `npm start` and open `https://localhost:3443/admin` (accept the self-signed cert if prompted).
5. Verify logs show:
   - `[CORS] Allowed origins: ...`
   - `HTTPS server listening at https://0.0.0.0:3443`

This ensures the rubric items for password security, HTTPS transport, and documented secure startup are satisfied.
