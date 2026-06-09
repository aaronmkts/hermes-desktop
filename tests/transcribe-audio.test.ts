import { describe, expect, it } from "vitest";
import {
  resolveTranscriptionRoute,
  transcriptionErrorMessage,
} from "../src/main/hermes";

describe("resolveTranscriptionRoute", () => {
  it("does not send audio to the Codex chat backend and falls back to Gemini when Google API key is available", () => {
    expect(
      resolveTranscriptionRoute({
        baseUrl: "https://chatgpt.com/backend-api/codex",
        env: { GOOGLE_API_KEY: "google-key" },
      }),
    ).toEqual({ provider: "gemini", apiKey: "google-key", model: "gemini-2.5-flash" });
  });

  it("prefers an explicit voice OpenAI key and base URL when configured", () => {
    expect(
      resolveTranscriptionRoute({
        baseUrl: "https://chatgpt.com/backend-api/codex",
        env: {
          VOICE_TOOLS_OPENAI_KEY: "voice-key",
          VOICE_TOOLS_OPENAI_BASE_URL: "https://api.openai.com/v1",
          GOOGLE_API_KEY: "google-key",
        },
      }),
    ).toEqual({ provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKey: "voice-key", model: "whisper-1" });
  });

  it("returns a specific configuration error when no transcription route is available", () => {
    expect(transcriptionErrorMessage({ baseUrl: "https://chatgpt.com/backend-api/codex", env: {} })).toContain("Voice input needs either VOICE_TOOLS_OPENAI_KEY");
  });
});
