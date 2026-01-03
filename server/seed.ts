import { db } from "./db";
import { providers } from "@shared/schema";

async function seed() {
  console.log("Seeding database...");

  // Insert seed providers
  const seedProviders = [
    {
      address: "0x71C95911E9a5D330f4D621842EC243EE13432921",
      name: "AWS High-Perf Cluster",
      metaHash: "ipfs://QmHash123",
      status: "active" as const,
      pricing: "10.00",
    },
    {
      address: "0x82D39511E9a5D330f4D621842EC243EE13433B44",
      name: "Decentralized GPU Node A",
      metaHash: "ipfs://QmHash456",
      status: "active" as const,
      pricing: "5.00",
    },
    {
      address: "0x93E39511E9a5D330f4D621842EC243EE13435C67",
      name: "Bare Metal Server EU",
      metaHash: "ipfs://QmHash789",
      status: "inactive" as const,
      pricing: "15.00",
    },
    {
      address: "0xA4F39511E9a5D330f4D621842EC243EE13437D89",
      name: "Community Node #42",
      metaHash: "ipfs://QmHashABC",
      status: "active" as const,
      pricing: "2.00",
    },
  ];

  for (const provider of seedProviders) {
    try {
      await db.insert(providers).values(provider).onConflictDoNothing();
      console.log(`✓ Seeded provider: ${provider.name}`);
    } catch (error) {
      console.log(`Already exists: ${provider.name}`);
    }
  }

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
