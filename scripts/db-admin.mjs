import { closePool, describeDatabaseTarget } from "../server/db.js";
import {
  initEnvironment,
  inspectDatabase,
  runMigrations,
  seedDemoListings,
  setWritesFrozen,
} from "../server/migrator.js";
import { reconcilePhotos } from "../server/storage.js";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--env" && rest[i + 1]) {
      flags.env = rest[++i];
    } else if (token.startsWith("--env=")) {
      flags.env = token.slice("--env=".length);
    } else if (token === "--allow-production") {
      flags.allowProduction = true;
    } else if (token === "--on") {
      flags.frozen = true;
    } else if (token === "--off") {
      flags.frozen = false;
    } else if (token === "--min-age-minutes" && rest[i + 1]) {
      flags.minAgeMinutes = Number(rest[++i]);
    }
  }
  return { command, flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const target = describeDatabaseTarget();

  if (!command || command === "--help" || command === "-h") {
    console.log(
      "Usage: node scripts/db-admin.mjs <inspect|init|migrate|seed|freeze|reconcile-photos> [--env <env>] [--on|--off] [--allow-production] [--min-age-minutes <n>]"
    );
    return;
  }

  console.log("DB Target:", JSON.stringify(target));

  if (command === "inspect") {
    const info = await inspectDatabase();
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (command === "init") {
    const result = await initEnvironment({ env: flags.env });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "migrate") {
    const result = await runMigrations({ env: flags.env });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "seed") {
    const result = await seedDemoListings({
      env: flags.env,
      allowProduction: Boolean(flags.allowProduction),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "freeze") {
    if (typeof flags.frozen !== "boolean") {
      throw new Error("freeze requires --on or --off");
    }
    const result = await setWritesFrozen({ env: flags.env, frozen: flags.frozen });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "reconcile-photos") {
    const minAgeMs =
      Number.isFinite(flags.minAgeMinutes) && flags.minAgeMinutes >= 0
        ? flags.minAgeMinutes * 60 * 1000
        : 10 * 60 * 1000;
    const result = await reconcilePhotos({ minAgeMs });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main()
  .catch((error) => {
    console.error("db-admin error:", error?.code || "ERROR", error?.message || "unknown");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
