import { describe, expect, it } from "vitest";
import { orientationOf, validateDuration, validateFile } from "@/lib/video/probe";

const MB = 1024 * 1024;

describe("validateFile", () => {
  it("accepts mp4, mov and webm", () => {
    expect(validateFile({ name: "a.mp4", size: 5 * MB, type: "video/mp4" })).toBeNull();
    expect(validateFile({ name: "IMG_1.MOV", size: 5 * MB, type: "video/quicktime" })).toBeNull();
    expect(validateFile({ name: "a.webm", size: 5 * MB, type: "video/webm" })).toBeNull();
  });
  it("falls back to the extension when the MIME type is missing", () => {
    expect(validateFile({ name: "clip.mov", size: MB, type: "" })).toBeNull();
    expect(validateFile({ name: "clip.txt", size: MB, type: "" })?.code).toBe("bad_file_type");
  });
  it("rejects other types", () => {
    expect(validateFile({ name: "a.png", size: MB, type: "image/png" })?.code).toBe("bad_file_type");
    expect(validateFile({ name: "a.avi", size: MB, type: "video/x-msvideo" })?.code).toBe("bad_file_type");
  });
  it("rejects files over 200 MB and empty files", () => {
    expect(validateFile({ name: "a.mp4", size: 200 * MB, type: "video/mp4" })).toBeNull();
    expect(validateFile({ name: "a.mp4", size: 200 * MB + 1, type: "video/mp4" })?.code).toBe("file_too_large");
    expect(validateFile({ name: "a.mp4", size: 0, type: "video/mp4" })?.code).toBe("bad_file_type");
  });
});

describe("validateDuration / orientation", () => {
  it("rejects clips over 60 s", () => {
    expect(validateDuration(15)).toBeNull();
    expect(validateDuration(60)).toBeNull();
    expect(validateDuration(61)?.code).toBe("video_too_long");
    expect(validateDuration(NaN)?.code).toBe("unsupported_codec");
  });
  it("orientation", () => {
    expect(orientationOf(720, 1280)).toBe("portrait");
    expect(orientationOf(1280, 720)).toBe("landscape");
    expect(orientationOf(1000, 1010)).toBe("square");
  });
});
