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
        assetDecimals: 7,
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
        assetDecimals: 7,
        description: 'Earn staking rewards on native XLM.',
        apy: 4.5,
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ Seeded ${vaults.length} vaults`);

  const appVersionConfigs = await Promise.all([
    prisma.appVersionConfig.upsert({
      where: { platform: 'IOS' },
      update: {},
      create: {
        platform: 'IOS',
        minVersion: '1.0.0',
        latestVersion: '1.0.0',
        storeUrl: 'https://apps.apple.com/app/id6798366548',
      },
    }),
    prisma.appVersionConfig.upsert({
      where: { platform: 'ANDROID' },
      update: {},
      create: {
        platform: 'ANDROID',
        minVersion: '1.0.0',
        latestVersion: '1.0.0',
        storeUrl: 'https://play.google.com/store/apps/details?id=com.pigfi.app',
      },
    }),
  ]);

  console.log(`✅ Seeded ${appVersionConfigs.length} app version configs`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
