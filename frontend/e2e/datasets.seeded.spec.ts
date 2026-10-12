import { expect, test } from "./_fixtures";
import { compatibilityHeaders } from "./_compatibility";

const SELECTION_KEY = "dataset:named:jailbreak_templates";

interface SeedExampleSummary {
  example_id: string;
  name: string | null;
  preview: string;
}

interface SeedMember {
  data_type: string;
  value: string;
}

interface SeedExampleDetail extends SeedExampleSummary {
  members: SeedMember[];
}

async function waitForBackend(request: { get: (url: string, options?: { timeout?: number }) => Promise<{ ok: () => boolean }> }): Promise<void> {
  const maxWait = 60_000;
  const interval = 1_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await request.get("/api/health", { timeout: 2_000 });
      if (response.ok()) return;
    } catch {
      // The backend is still loading the local jailbreak templates.
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Backend did not become healthy within 60 seconds");
}

test.describe("dataset examples against the real backend @seeded", () => {
  test.beforeAll(async ({ request }) => {
    await waitForBackend(request);
  });

  test("lists stored examples and opens one member @seeded", async ({ page, request }) => {
    test.setTimeout(90_000);
    const headers = compatibilityHeaders();
    const datasets = await request.get("/api/datasets?loaded_only=true", { headers });
    expect(datasets.ok(), await datasets.text()).toBe(true);
    const catalog = await datasets.json() as { items: Array<{ name: string; selection_key: string; logical_examples: number | null }> };
    const dataset = catalog.items.find((item) => item.selection_key === SELECTION_KEY);
    expect(dataset?.name).toBe("jailbreak_templates");
    expect(dataset?.logical_examples ?? 0).toBeGreaterThan(0);

    const list = await request.get(
      `/api/datasets/seeds?selection_key=${encodeURIComponent(SELECTION_KEY)}&limit=20`,
      { headers },
    );
    expect(list.ok(), await list.text()).toBe(true);
    const pageData = await list.json() as { items: SeedExampleSummary[]; total: number };
    const first = pageData.items[0];
    if (!first?.example_id) {
      throw new Error("Expected the local dataset to return at least one example");
    }
    expect(first.example_id).toMatch(/[a-f]/);

    const detailResponse = await request.get(
      `/api/datasets/seeds/${first.example_id}?selection_key=${encodeURIComponent(SELECTION_KEY)}`,
      { headers },
    );
    expect(detailResponse.ok(), await detailResponse.text()).toBe(true);
    const detail = await detailResponse.json() as SeedExampleDetail;
    expect(detail.example_id).toBe(first.example_id);
    const textMember = detail.members.find((member) => member.data_type === "text" && member.value.trim() !== "");
    if (!textMember) {
      throw new Error("Expected the stored example to include a text member");
    }

    await page.goto(`/datasets/detail?selection_key=${encodeURIComponent(SELECTION_KEY)}`);
    await expect(page.getByRole("heading", { level: 1, name: "jailbreak_templates" })).toBeVisible();
    const table = page.getByRole("table", { name: "Examples" });
    await expect(table).toBeVisible();
    await expect(page.getByTestId("example-status")).toContainText("matching example");
    const firstRow = table.getByRole("row").nth(1);
    await expect(firstRow).toContainText(first.preview);
    const label = first.name || first.preview || first.example_id;
    await firstRow.getByRole("button", { name: `Show ${label}` }).click();

    const region = page.getByRole("region", { name: "Example detail" });
    const snippet = textMember.value.replace(/\s+/g, " ").trim().slice(0, 80);
    await expect(region.getByText(snippet, { exact: false })).toBeVisible();
    await expect(region.locator("img, audio, video")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`[?&]example=${first.example_id}`));

    await page.reload();
    await expect(page.getByRole("region", { name: "Example detail" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]example=${first.example_id}`));
    await expect(page).toHaveURL(new RegExp(`selection_key=${encodeURIComponent(SELECTION_KEY)}`));

    const mismatched = first.example_id.toUpperCase();
    await page.goto(
      `/datasets/detail?selection_key=${encodeURIComponent(SELECTION_KEY)}&example=${mismatched}`,
    );
    await expect(page.getByText("This example is not in the dataset.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Example detail" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to the examples" }).click();
    await expect(page).not.toHaveURL(/[?&]example=/);
    await expect(page.getByRole("table", { name: "Examples" })).toBeVisible();
  });
});
