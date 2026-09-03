# Security finding — unauthenticated admin takeover via `/api/auth/enable`

**Target:** commit `c35e0d6` on branch `feat/451-optional-auth` (PR #452 / issue #451, "optional authentication for the web UI and MCP endpoint")

**Status:** open, unfixed as of this writing. This file is scratch notes for a follow-up agent; it is not checked in.

**Severity:** Medium
**Category:** authentication bypass / improper access control
**Confidence:** 7/10 — the code path is confirmed unambiguously by reading the source. The rating is below 8 only because reaching the vulnerable state requires an operator to have set a specific (supported, documented) option, not because there is any doubt about the mechanics.

---

## 1. Summary

`POST /api/auth/enable` is deliberately reachable without credentials, so that first-run setup can happen. Its guard against being called a second time is wrong in one reachable state: when UI login is **forced on by the environment** (`AUTH_UI_ENABLED=true`, or the new Home Assistant add-on option `AUTH_UI: "on"`) while `auth.json` does not yet contain a user, **any unauthenticated party who can reach the port can create the administrator account and receive a valid session cookie.**

Every other `/api/` and `/ws/` path correctly returns 401 in that state, which is what makes it deceptive: the instance looks locked down, and the UI actively reports "Login: ● Required".

## 2. Why both guards fail

There are two guards. They are the same predicate evaluated against two different sources, which is exactly why neither one catches this case.

**Guard 1 — the endpoint** (`backend/api.py:1005`):

```python
if auth.ui_auth_enabled() and auth.usernames():
    raise HTTPException(status_code=409, detail="Authentication is already enabled")
```

`ui_auth_enabled()` (`backend/auth.py:181-191`) returns `True` from the **env override**, without touching disk. `usernames()` returns `[]`. `True and []` is falsy → no 409.

**Guard 2 — the state layer** (`backend/auth.py:216-221`):

```python
data = _load()
if data.get("ui_auth_enabled") and data.get("users"):
    raise ValueError("authentication is already enabled")
```

This reads the **on-disk** flag, which the env override never writes, so it is still `False` → passes.

The handler then creates the admin and logs the caller straight in (`backend/api.py:1011-1013`):

```python
token = auth.login(payload.username, payload.password)
if token:
    response.set_cookie(auth.SESSION_COOKIE, token, **auth_middleware.cookie_kwargs())
```

Note `auth.login()` is called here without `peer=`, so the login throttle (`backend/auth.py:279-294`) is not engaged on this path at all.

**Why the middleware does not stop it** (`backend/auth_middleware.py:22-29`, `:94-96`): `/api/auth/enable` is in `_OPEN_PREFIXES`, and the open-prefix check short-circuits *before* both the ingress check (`:100`) and the session check (`:104`). So the endpoint is served regardless of `ui_auth_enabled()`, while everything else falls through to the 401 at `:108`.

For contrast, the case where **users already exist** is safe: guard 1 sees a non-empty `usernames()` and returns 409. Only the empty-user-list state is exposed. Do not "fix" the already-populated case; it is not broken.

## 3. How the vulnerable state is reached

Two supported paths, both documented:

* **Home Assistant add-on.** `ha-addon/config.yaml:36-40` adds `AUTH_UI: "list(auto|on|off)"` with `"on"` described as forcing login. `ha-addon/rootfs/etc/services.d/spectrum_knx/run:71-76` maps it:

  ```sh
  AUTH_UI=$(bashio::config 'AUTH_UI' 'auto')
  case "$AUTH_UI" in
      on)  export AUTH_UI_ENABLED=true ;;
      off) export AUTH_UI_ENABLED=false ... ;;
  esac
  ```

  Setting this on a fresh install — before any account exists — is the natural way an operator would "turn the security option on". The same option is present in `ha-addon-beta/`, `ha-addon-companion/` and `ha-addon-companion-beta/`; all four add-ons ship the same image, so the one run script covers them all.

* **Docker / Debian.** `DEPLOYMENT.md:809` documents `AUTH_UI_ENABLED` as "Force UI login on **or off**". A first deployment with the flag pre-set lands in the same state.

**Network exposure:** `ha-addon/config.yaml:6` sets `host_network: true`, and `ha-addon/rootfs/etc/services.d/spectrum_knx/run:100` runs `uvicorn main:app --host 0.0.0.0 --port 8765`. The endpoint is on the LAN.

## 4. The window does not close on its own

In the add-on this is **not** a brief first-run race. It persists indefinitely until someone notices:

* Ingress requests are attributed to `"home-assistant"` and count as authenticated (`backend/api.py:966-974`).
* `loginRequired` is therefore false for the sidebar admin (`frontend/src/hooks/useAuthStatus.ts:45-47`), so the "Create an account" screen (`frontend/src/components/LoginScreen.tsx:20`, `:82-85`) is **never shown** to them.
* `frontend/src/components/AuthSettings.tsx:70-72` renders a green **"Login: ● Required"**, and the "Enable login" setup form at `:86` is hidden because `ui_auth_enabled` is true.

So the operator's every signal says "protected". The only cue that the instance is unowned is an empty Users list, which nothing draws attention to.

`backend/tests/test_auth.py` exercises only `AUTH_UI_ENABLED=false` (line 240). The forced-**on**-with-no-users state has no test at all, which suggests oversight rather than an accepted trade-off. `LoginScreen.tsx:14-17` acknowledges the state exists but treats it as benign setup.

## 5. Reproduction

```bash
# Preconditions: no auth.json (or one with an empty users list), and
#   AUTH_UI_ENABLED=true   (Docker/Debian)
#   AUTH_UI: "on"          (HA add-on config)

# Every other route is correctly locked:
curl -si http://<host>:8765/api/server/config | head -1        # HTTP/1.1 401 Unauthorized

# But this one is not:
curl -X POST http://<host>:8765/api/auth/enable \
     -H 'Content-Type: application/json' \
     -d '{"username":"attacker","password":"hunter2hunter2"}' \
     -c jar
# → 200 {"status":"ok","user":"attacker"} + Set-Cookie: spectrumknx_session=...

curl -b jar -si http://<host>:8765/api/server/config | head -1  # HTTP/1.1 200 OK
```

## 6. Impact

A permanent local admin account plus a live session, and with it every guarded route:

| Route | File:line | What it gives |
| --- | --- | --- |
| `POST /api/knx/send` | `backend/api.py:518` | arbitrary writes to the KNX bus — lights, blinds, HVAC, any addressable actuator |
| `POST /api/knx/send/scheduled` | `backend/api.py:551` | the same, on a schedule |
| `POST /api/database/purge` | `backend/api.py:592` | destroys telegram history |
| `POST /api/project/upload` | `backend/api.py:885` | replaces the ETS project |
| `POST /api/knxkeys/upload` | `backend/api.py:1128` | KNX Secure key material |
| `POST /api/auth/mcp-token` | `backend/api.py:1085` | mints an MCP token |
| `GET /ws/telegrams`, telegram history | — | full visibility into the installation |

The legitimate admin keeps working normally through ingress and observes no symptom. Recovery is awkward: `delete_user` refuses to remove the last account while auth is enabled (`backend/auth.py:253-255`), so the operator has to flip `AUTH_UI` to `off`/`auto` first.

## 7. Recommended fix

Preferred, and the smallest change that actually matches intent: **stop treating `/api/auth/enable` as unconditionally open.** Remove it from `_OPEN_PREFIXES` (`backend/auth_middleware.py:28`) and let the middleware admit it only when `not auth.ui_auth_enabled()` — i.e. precisely the state in which the whole API is open anyway, so nothing is lost by allowing it and nothing is exposed that was not already.

Under that rule, first-account creation while the flag is forced on requires either an ingress peer (add-on: HA has already authenticated an admin) or setting `AUTH_UI` to `auto`/`off` for the setup step — which is already the documented recovery path, so no new operator burden.

Alternative if the endpoint must stay in `_OPEN_PREFIXES`: gate `enable_with_admin` on the **effective** flag rather than the on-disk one, e.g. refuse when `ui_auth_enabled() or data.get("ui_auth_enabled())` is true unless the caller is already trusted, and mirror that at `backend/api.py:1005`.

Complementary, worth doing either way:

* `frontend/src/components/AuthSettings.tsx` — warn when `ui_auth_enabled && !configured`: "login is forced on but no account exists — anyone who can reach this port can claim it".
* `backend/tests/test_auth.py` — add a regression test for `AUTH_UI_ENABLED=true` with an empty `auth.json`, asserting that an anonymous `POST /api/auth/enable` is refused.
* Note that `enable_with_admin` replaces `data["users"]` wholesale (`backend/auth.py:216-221`) rather than appending; worth keeping in mind while editing.

---

## Appendix A — candidates that were checked and dismissed

Recorded so a follow-up agent does not re-litigate them. Each was independently verified against the source.

* **Fail-open when `auth.json` is unreadable** (`backend/auth.py:103-108`). The behaviour is real — `_load()` catches `(OSError, ValueError)` and returns an unconfigured dict, the file is re-read per request with no cache, so a corrupt file disables auth instantly. But **no unauthenticated or lower-privileged request path can corrupt, truncate or clobber that file.** Every writer uses a constant path; `upload_project` uses `file.filename` only for the `.knxproj` extension check and as a JSON value in the meta sidecar, never in path construction. `_save()`'s `os.open(0o600)` → `fsync` → `os.replace` genuinely prevents torn writes, and errors raise before the rename. The only triggers need filesystem write access to the state dir, which already permits simply deleting the file or writing an attacker-controlled hash. Not exploitable.
  * One real robustness bug found in passing: `_load()` does not guard against JSON that parses to a non-object (`[]`, `"x"`, `3`) — `data.setdefault(...)` at `auth.py:109` then raises `AttributeError` on every request, including `/api/auth/status`. Fails closed, so a bug rather than a vulnerability. An `isinstance(data, dict)` check would close it.
* **`/mcp` exempt from UI session auth** (`backend/auth_middleware.py:81-86`). Real and documented, but **pre-existing**: at `c35e0d6^` the mount had no authentication of any kind, and `backend/mcp_server.py` is untouched by this commit. There is no configuration in which the PR makes `/mcp` more reachable than before — it strictly improves the path by adding an optional token. Design is stated in `DEPLOYMENT.md` §11 ("two switches, independent of each other"). Optional hardening if desired: accept *either* a valid MCP token or a valid UI session, and require some credential once `ui_auth_enabled()` is true; also add a `/mcp` row to the §11.2 "reachable without logging in" table, which currently omits it.
* **CSRF against the new session cookie / `change_password` without the current password** (`backend/api.py:1072-1082`). The server side *is* the classic dangerous CORS pairing — `backend/main.py:72-78` sets `allow_origins=["*"]` with `allow_credentials=True`, and Starlette's `CORSMiddleware` does echo the request Origin plus `Access-Control-Allow-Credentials: true` in that combination. But the explicit `samesite="lax"` in `cookie_kwargs()` (`backend/auth_middleware.py:137`) means the browser never attaches the cookie to a cross-site fetch/XHR or a cross-site POST. Chrome's "Lax+POST" two-minute grace applies only to cookies with *no* SameSite attribute, not an explicit `Lax`. All GET routes were checked and are read-only. Reaching the endpoint requires already holding the session cookie, at which point the attacker owns the instance regardless. Hardening, not a live bug.
* **Flat permission model** — any authenticated user can add/delete any other (`backend/auth.py:234-261`). Documented at `DEPLOYMENT.md:727-728` ("All accounts are equal — there are no roles"). There is no privilege boundary to cross. `delete_user` already guards the lockout case.
* **Session lifecycle** — no idle/absolute expiry, no rotation, and `change_password` does not evict the user's other sessions (while `delete_user` and `disable()` do). `secrets.token_urlsafe(32)` is 256 bits of CSPRNG, so no entropy issue. Sessions are in-process and die on restart, bounding the window. Standard hardening.
* **Username-existence timing oracle** — `login()` (`backend/auth.py:297-307`) only runs scrypt (~52 ms) when the username matches, leaking existence. Throttling caps probing at 5 failures per address per 300 s plus a 60 s lockout, and any authenticated user can read the user list anyway. Noise. If closing it regardless: verify against a dummy record on the miss path.
* **Ingress bypass via forged headers** — the design holds. `is_ingress_peer` (`backend/auth.py:365-378`) reads only the ASGI connection tuple and additionally requires `SUPERVISOR_TOKEN`, so it is inert outside the add-on; no header is consulted anywhere. **No launcher passes `--proxy-headers` or `--forwarded-allow-ips`**: `Dockerfile:42`, `backend/Dockerfile:21`, `ha-addon/rootfs/etc/services.d/spectrum_knx/run:100`, `packaging/debian/spectrum-knx.service:18`, `packaging/windows/launcher.py:79`, `.github/workflows/release.yml:121`. No reverse proxy in any image. The regression test in `test_auth.py` is sound.

## Appendix B — two notes for the backlog

Neither meets the bar for a reported finding; both are worth a ticket.

1. **The `--proxy-headers` premise in the code comments is slightly wrong.** uvicorn enables `ProxyHeadersMiddleware` **by default** (`proxy_headers: bool = True`, with `forwarded_allow_ips` falling back to `os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")`). The comments at `backend/main.py:86-90` and `backend/auth.py:369-371` imply proxy headers are off unless explicitly turned on; they are on, with the trust boundary at loopback. Practical consequence: a client connecting **from `127.0.0.1`** can send `X-Forwarded-For: 172.30.32.2`, have `scope["client"]` rewritten, satisfy `is_ingress_peer` and bypass UI auth. Under `host_network: true` that loopback is the HA host's, so this needs code execution on the host already (other add-ons sit on the 172.30.32.0/23 bridge, not loopback) — local-only, below Medium. Belt and braces: pass `--forwarded-allow-ips=""` (or `proxy_headers=False`) explicitly in the launchers so the default cannot drift.
2. **`CORS_ORIGINS=*` + `allow_credentials=True` is now load-bearing on `SameSite=Lax`.** `backend/main.py:72-78` and `backend/auth_middleware.py:137` are coupled as of this PR: the permissive CORS is neutralised *only* by the cookie's explicit `Lax`. Anyone later loosening the cookie to `SameSite=None` — a plausible move to support iframe embedding — converts this into full credentialed cross-origin account takeover. Prefer a concrete `CORS_ORIGINS` default, or at minimum stop pairing `*` with `allow_credentials=True`. Related nuance: `SameSite` is scoped by site and ignores ports, so on the add-on SpectrumKNX at `<host>:8765` is same-site with Home Assistant at `<host>:8123` — attacker-controlled HTML served from another port of the same host (e.g. a file dropped in HA's `/local/`) would get the cookie attached *and* a readable response via the origin echo.
