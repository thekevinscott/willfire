import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withinRoot } from "./withinRoot.js";

// The isolation gate wants collaborators mocked; resolving real symlinks is
// what this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock("node:os", async () => await vi.importActual<typeof import("node:os")>("node:os"));
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));

const fixture = async (): Promise<{ base: string; root: string }> => {
  const base = await mkdtemp(join(tmpdir(), "wf-within-root-"));
  const root = join(base, "root");
  await mkdir(join(root, "nested"), { recursive: true });
  await mkdir(join(base, "outside"));
  return { base, root };
};

describe("withinRoot", () => {
  it("accepts the root itself and anything under it", async () => {
    const { root } = await fixture();
    expect(await withinRoot(root, root)).toBe(true);
    expect(await withinRoot(root, join(root, "nested"))).toBe(true);
  });

  it("refuses the root's parent and a sibling reached by climbing", async () => {
    const { base, root } = await fixture();
    expect(await withinRoot(root, base)).toBe(false);
    expect(await withinRoot(root, join(root, "..", "outside"))).toBe(false);
  });

  it("refuses a symlink under the root that points out of it", async () => {
    const { base, root } = await fixture();
    await symlink(join(base, "outside"), join(root, "link"));
    expect(await withinRoot(root, join(root, "link"))).toBe(false);
  });

  it("compares lexically when neither path resolves", async () => {
    expect(await withinRoot("/nonexistent-tree", "/nonexistent-tree/action")).toBe(true);
    expect(await withinRoot("/nonexistent-tree", "/nonexistent-other")).toBe(false);
  });
});
