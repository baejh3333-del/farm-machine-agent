# Unified voice integration verification

Date: 2026-11-17

## Consolidation

- #32 and #33: existing ancestor commits retain delegation and motion/layout work.
- #30: composer plus menu and centralized Escape handling integrated into the current panel.
- #31: insurance server metadata and tests match the source branch; the panel shares contact rendering with repair results.
- #34: STT/TTS modules, API routing, rate limits and tests integrated. The old voice-panel module is replaced by the current panel and live controller. The HTTP integration test was retained and updated for the expanded capability response.
- #28: superseded by the current unified `/api/agent` tool flow; the older `nongnong.js` implementation is not reintroduced.

## Integration repairs

- Forward voice input mode and delegation ID through the browser request body.
- Match panel callbacks and getter names to the actual voice modules.
- Fence pending microphone starts, recognition, backend replies and speech when stopping or closing the panel.
- Play remote audio, including streamless WebRTC tracks; release media on cancellation, disconnect and server close.
- Prevent duplicate delegation events and sends over unopened channels.
- Keep spoken approval separate from screen confirmation.

## Verification scope

- Production build and full Node test suite.
- Chromium integration test uses the real application DOM and modules with simulated provider responses and media. It checks live delegation payloads, insurance contacts, menu/Escape behavior, fullscreen image cards versus docked cards, uninterrupted layout switching, mute/stop, late-event fencing, fallback voice mode, and recognition completion after panel close.
- PGlite HTTP integration checks voice rewrite routing, malformed and oversized audio, unavailable provider responses, successful mocked transcription and rate limiting.
- Four real PostgreSQL multi-connection tests require `TEST_DATABASE_URL` and remain skipped in this environment.
- Real provider audio quality, project access and microphone-to-provider connectivity have not been verified. Browser/provider simulations are not a real GPT-Live call.
- WebRTC connection and shutdown behavior were checked against https://developers.openai.com/api/docs/guides/voice-webrtc .

The API directory contains 11 files; voice uses the existing agent function rewrite.
