import { z } from "zod";

export async function farmGet<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const baseUrl = process.env.FARM_API_BASE_URL;
  const token = process.env.FARM_AGENT_API_TOKEN;
  if (!baseUrl || !token) throw new Error("FARM_API_BASE_URL and FARM_AGENT_API_TOKEN are required");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("FARM_API_BASE_URL must use HTTPS outside localhost");
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Cross-origin API path rejected");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Farm API request failed: ${response.status}`);
  return schema.parse(await response.json());
}
