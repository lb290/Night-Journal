/**
 * Tests for the attachment path validators.
 *
 * These guard the accept path for attachments added while editing an entry.
 * A wrong thumbnail path could point at another user's file, so the rules are
 * worth pinning explicitly rather than relying on integration coverage.
 */

import { describe, it, expect } from "vitest";
import { isValidStoragePath, isValidAttachmentFileUrl } from "./index";

describe("isValidStoragePath", () => {
  it("accepts <userId>/<file>", () => {
    expect(isValidStoragePath(10, "10/x.jpg")).toBe(true);
  });

  it("accepts <userId>/thumb/<file>", () => {
    expect(isValidStoragePath(10, "10/thumb/x.jpg")).toBe(true);
  });

  it("rejects another user's folder", () => {
    expect(isValidStoragePath(10, "11/x.jpg")).toBe(false);
    expect(isValidStoragePath(10, "11/thumb/x.jpg")).toBe(false);
  });

  it("rejects nested folders that are not thumb", () => {
    expect(isValidStoragePath(10, "10/nested/x.jpg")).toBe(false);
  });

  it("rejects path traversal and absolute paths", () => {
    expect(isValidStoragePath(10, "../10/x.jpg")).toBe(false);
    expect(isValidStoragePath(10, "10/../x.jpg")).toBe(false);
    expect(isValidStoragePath(10, "10\\x.jpg")).toBe(false);
    expect(isValidStoragePath(10, "/10/x.jpg")).toBe(false);
  });

  it("rejects malformed shapes", () => {
    expect(isValidStoragePath(10, "")).toBe(false);
    expect(isValidStoragePath(10, "10")).toBe(false);
    expect(isValidStoragePath(10, "10/")).toBe(false);
    expect(isValidStoragePath(10, "10/a/b/c.jpg")).toBe(false);
  });
});

describe("isValidAttachmentFileUrl", () => {
  it("accepts a URL derived from the storage path", () => {
    expect(isValidAttachmentFileUrl("10/x.jpg", "/api/uploads/10/x.jpg")).toBe(true);
    expect(
      isValidAttachmentFileUrl("10/thumb/x.jpg", "/api/uploads/10/thumb/x.jpg"),
    ).toBe(true);
  });

  it("rejects a URL that does not match the storage path", () => {
    expect(isValidAttachmentFileUrl("10/x.jpg", "/api/uploads/10/other.jpg")).toBe(false);
  });

  it("rejects non-upload URLs", () => {
    expect(isValidAttachmentFileUrl("10/x.jpg", "https://evil.test/10/x.jpg")).toBe(false);
    expect(isValidAttachmentFileUrl("10/x.jpg", "/etc/passwd")).toBe(false);
  });

  it("rejects traversal in the URL suffix", () => {
    expect(isValidAttachmentFileUrl("../x.jpg", "/api/uploads/../x.jpg")).toBe(false);
  });
});
