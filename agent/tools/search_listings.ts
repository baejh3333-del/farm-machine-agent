import { defineTool } from "eve/tools";
import { z } from "zod";
import { farmGet } from "../lib/farm-api";

const listing = z.object({
  id: z.string(), title: z.string(), transactionType: z.enum(["rent", "sale"]),
  cropId: z.string(), stageId: z.string(), machineType: z.string(),
  region: z.string(), straightLineKm: z.number().nullable(),
  priceKrw: z.number().nonnegative(), priceUnit: z.enum(["day", "total"]),
  status: z.string(), condition: z.string(), inspectedAt: z.string().nullable(),
  updatedAt: z.string(), ownerDescription: z.string(),
  compatibilityReasons: z.array(z.string()), checks: z.array(z.string()),
});
const results = z.object({ asOf: z.string(), listings: z.array(listing).max(3) });

export default defineTool({
  description: "Search currently published, server-filtered farm machinery listings. The server enforces crop/stage compatibility, working condition, transaction status, region, and rental date availability. Read-only; results are a snapshot, not a reservation.",
  inputSchema: z.object({
    cropId: z.string().min(1), stageId: z.string().min(1),
    transactionType: z.enum(["rent", "sale"]), region: z.string().min(1),
    areaSquareMeters: z.number().positive().optional(),
    fieldConditions: z.array(z.string()).default([]),
    startDate: z.iso.date().optional(), endDate: z.iso.date().optional(),
  }).refine(v => v.transactionType === "sale" || (!!v.startDate && !!v.endDate && v.endDate >= v.startDate), {
    message: "Rental search requires a valid start and end date",
  }),
  async execute(input) {
    const query = new URLSearchParams({
      cropId: input.cropId, stageId: input.stageId,
      transactionType: input.transactionType, region: input.region,
      limit: "3",
    });
    if (input.areaSquareMeters !== undefined) query.set("areaSquareMeters", String(input.areaSquareMeters));
    for (const condition of input.fieldConditions) query.append("fieldCondition", condition);
    if (input.startDate) query.set("startDate", input.startDate);
    if (input.endDate) query.set("endDate", input.endDate);
    return farmGet(`/internal/agent/listings?${query}`, results);
  },
});
