import { defineTool } from "eve/tools";
import { z } from "zod";
import { farmGet } from "../lib/farm-api";

const stage = z.object({
  id: z.string(), name: z.string(), explanation: z.string(),
  equipmentRequired: z.boolean(),
  equipment: z.array(z.object({ type: z.string(), purpose: z.string(), conditions: z.array(z.string()), checks: z.array(z.string()) })),
});
const guidance = z.object({
  cropId: z.string(), cropName: z.string(), region: z.string().nullable(),
  source: z.string(), reviewedAt: z.string(), stages: z.array(stage),
});

export default defineTool({
  description: "Get reviewed crop stages and equipment guidance. Returns no advice for unsupported crops.",
  inputSchema: z.object({ cropId: z.string().min(1), region: z.string().optional() }),
  async execute({ cropId, region }) {
    const query = new URLSearchParams({ cropId });
    if (region) query.set("region", region);
    return farmGet(`/internal/agent/crop-guidance?${query}`, guidance);
  },
});
