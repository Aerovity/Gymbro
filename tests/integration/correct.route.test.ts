import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionTimeoutError, BadRequestError, InternalServerError } from "openai";
import type { CorrectRequest } from "@/lib/schemas";
import { JPEG, SECRETS, post, setEnv } from "./helpers";

const openai = vi.hoisted(() => ({ images: { edit: vi.fn() } }));
vi.mock("@/lib/providers/openaiClient", () => ({ getOpenAI: () => openai, resetOpenAI: () => undefined }));

const { POST } = await import("@/app/api/correct/route");

const body = (o: Partial<CorrectRequest> = {}): CorrectRequest => ({
  exercise: "pull_up",
  beforeDataUrl: JPEG,
  size: "1024x1536",
  correctedPose: {
    description: "Chin clearly over the bar, elbows pulled to the ribs.",
    joint_targets: [{ angle_key: "elbow_top", target_deg: 60 }],
  },
  primaryFault: "Partial range at the top",
  ...o,
});

const ok = { data: [{ b64_json: "QUFBQQ==" }], output_format: "jpeg" };

describe("POST /api/correct", () => {
  beforeEach(() => {
    setEnv({ OPENAI_IMAGE_MODEL: "gpt-image-test", OPENAI_IMAGE_QUALITY: "high" });
    openai.images.edit.mockReset();
  });

  it("builds the edit with model/size/quality/jpeg and returns a data URL", async () => {
    openai.images.edit.mockResolvedValue(ok);
    const res = await POST(post("/api/correct", body()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json.imageDataUrl).toBe("data:image/jpeg;base64,QUFBQQ==");
    expect(json.model).toBe("gpt-image-test");
    expect(typeof json.ms).toBe("number");

    const [params, options] = openai.images.edit.mock.calls[0];
    expect(params).toMatchObject({
      model: "gpt-image-test",
      size: "1024x1536",
      quality: "high",
      output_format: "jpeg",
      output_compression: 85,
      n: 1,
    });
    expect(params).not.toHaveProperty("input_fidelity");
    expect(Array.isArray(params.image)).toBe(true);
    expect(params.image[0]).toBeInstanceOf(File);
    expect(params.image[0].name).toBe("before.jpg");
    expect(params.image[0].type).toBe("image/jpeg");
    expect(params.prompt).toContain("pull-up on a bar");
    expect(params.prompt).toContain("elbow angle at the top ≈ 60°");
    expect(params.prompt).toContain("KEEP EXACTLY THE SAME");
    expect(options.timeout).toBe(60_000);
  });

  it("400 mentioning input_fidelity → retried once without it", async () => {
    setEnv({ OPENAI_IMAGE_INPUT_FIDELITY: "high" });
    openai.images.edit
      .mockRejectedValueOnce(
        new BadRequestError(400, { message: "Unknown parameter: 'input_fidelity'." }, "Unknown parameter: 'input_fidelity'.", new Headers()),
      )
      .mockResolvedValueOnce(ok);
    const res = await POST(post("/api/correct", body()));
    expect(res.status).toBe(200);
    expect(openai.images.edit).toHaveBeenCalledTimes(2);
    expect(openai.images.edit.mock.calls[0][0].input_fidelity).toBe("high");
    expect(openai.images.edit.mock.calls[1][0]).not.toHaveProperty("input_fidelity");
  });

  it("other 400s are not retried → 502 JSON without keys", async () => {
    openai.images.edit.mockRejectedValue(
      new BadRequestError(400, { message: "safety" }, `Rejected for key ${SECRETS.openai}`, new Headers()),
    );
    const res = await POST(post("/api/correct", body()));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(SECRETS.openai);
    expect(JSON.parse(text).error.code).toBe("correct_rejected");
    expect(openai.images.edit).toHaveBeenCalledTimes(1);
  });

  it("one retry on 5xx", async () => {
    openai.images.edit
      .mockRejectedValueOnce(new InternalServerError(500, { message: "oops" }, "oops", new Headers()))
      .mockResolvedValueOnce(ok);
    const res = await POST(post("/api/correct", body()));
    expect(res.status).toBe(200);
    expect(openai.images.edit).toHaveBeenCalledTimes(2);
  });

  it("timeout (after one retry) → 504 JSON", async () => {
    openai.images.edit.mockRejectedValue(new APIConnectionTimeoutError());
    const res = await POST(post("/api/correct", body({ attempt: 2, measuredMiss: "elbows still at 82°" })));
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("timeout");
    expect(openai.images.edit).toHaveBeenCalledTimes(2);
    const [params, options] = openai.images.edit.mock.calls[0];
    expect(params.prompt).toContain("elbows still at 82°");
    expect(options.timeout).toBe(45_000);
  });

  it("MOCK_AI → after.jpg (or the built-in JPEG) as a data URL", async () => {
    setEnv({ MOCK_AI: "1" });
    const res = await POST(post("/api/correct", body()));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.imageDataUrl).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    expect(json.model).toBe("demo");
    expect(openai.images.edit).not.toHaveBeenCalled();
  });

  it("invalid size → 400", async () => {
    const res = await POST(post("/api/correct", { ...body(), size: "512x512" }));
    expect(res.status).toBe(400);
  });
});
