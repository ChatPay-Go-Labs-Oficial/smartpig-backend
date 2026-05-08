import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  const vaults = await Promise.all([
    prisma.vaultCatalog.upsert({
      where: { defindexVaultId: 'vault-usdc-yield-1' },
      update: {},
      create: {
        defindexVaultId: 'vault-usdc-yield-1',
        name: 'USDC Yield Vault',
        assetSymbol: 'USDC',
        description: 'Stable yield on USDC via DeFindex liquidity strategies.',
        apy: 6.25,
        isActive: true,
      },
    }),
    prisma.vaultCatalog.upsert({
      where: { defindexVaultId: 'vault-xlm-staking-1' },
      update: {},
      create: {
        defindexVaultId: 'vault-xlm-staking-1',
        name: 'XLM Staking Vault',
        assetSymbol: 'XLM',
        description: 'Earn staking rewards on native XLM.',
        apy: 4.5,
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ Seeded ${vaults.length} vaults`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
