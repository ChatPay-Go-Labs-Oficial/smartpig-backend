import { NotFoundException } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

describe('AppConfigService', () => {
  function createHarness() {
    const prisma = {
      appVersionConfig: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    return {
      service: new AppConfigService(prisma as any),
      prisma,
    };
  }

  it('returns the config for an existing platform', async () => {
    const { service, prisma } = createHarness();
    const config = {
      id: 'cfg-1',
      platform: 'IOS',
      minVersion: '1.0.0',
      latestVersion: '1.2.0',
      storeUrl: 'https://apps.apple.com/app/id6798366548',
    };
    prisma.appVersionConfig.findUnique.mockResolvedValue(config);

    await expect(service.getByPlatform('IOS' as any)).resolves.toEqual(config);
    expect(prisma.appVersionConfig.findUnique).toHaveBeenCalledWith({
      where: { platform: 'IOS' },
    });
  });

  it('throws NotFoundException when no config exists for the platform', async () => {
    const { service, prisma } = createHarness();
    prisma.appVersionConfig.findUnique.mockResolvedValue(null);

    await expect(
      service.getByPlatform('ANDROID' as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists all platform configs', async () => {
    const { service, prisma } = createHarness();
    const configs = [{ platform: 'IOS' }, { platform: 'ANDROID' }];
    prisma.appVersionConfig.findMany.mockResolvedValue(configs);

    await expect(service.listAll()).resolves.toEqual(configs);
  });

  it('updates the config for a platform with the given fields', async () => {
    const { service, prisma } = createHarness();
    const dto = { minVersion: '1.3.0' };
    const updated = { platform: 'IOS', minVersion: '1.3.0' };
    prisma.appVersionConfig.update.mockResolvedValue(updated);

    await expect(service.update('IOS' as any, dto)).resolves.toEqual(updated);
    expect(prisma.appVersionConfig.update).toHaveBeenCalledWith({
      where: { platform: 'IOS' },
      data: dto,
    });
  });
});
