import { DisclosureService } from './disclosure.service';

interface DisclosureRow {
  id: string;
  vaultId: string;
  version: number;
  risks: unknown[];
  sections: unknown;
  publishedAt: Date | null;
}

interface AckRow {
  id: string;
  userId: string;
  vaultId: string;
  disclosureId: string;
  version: number;
  acknowledgedAt: Date;
  context?: unknown;
}

/**
 * A fake that enforces the composite unique key the real schema does.
 *
 * Asserting on mock calls would only prove the service builds a query; the point
 * of @@unique([userId, vaultId, version]) is the behaviour it produces, so the
 * store is keyed the same way and the tests exercise that.
 */
function createStore(disclosures: DisclosureRow[] = [], acks: AckRow[] = []) {
  const ackKey = (a: { userId: string; vaultId: string; version: number }) =>
    `${a.userId}|${a.vaultId}|${a.version}`;
  const ackStore = new Map(acks.map((a) => [ackKey(a), a]));
  let seq = 0;

  const prisma = {
    vaultDisclosure: {
      findFirst: jest.fn(
        ({
          where,
          orderBy,
        }: {
          where: { vaultId: string; publishedAt?: unknown };
          orderBy?: { version: 'desc' | 'asc' };
        }) => {
          const wantsPublished = where.publishedAt !== undefined;
          const matches = disclosures
            .filter((d) => d.vaultId === where.vaultId)
            .filter((d) => (wantsPublished ? d.publishedAt !== null : true))
            .sort((a, b) =>
              orderBy?.version === 'asc'
                ? a.version - b.version
                : b.version - a.version,
            );
          return Promise.resolve(matches[0] ?? null);
        },
      ),
      findMany: jest.fn(
        ({
          where,
        }: {
          where: { vaultId: { in: string[] }; publishedAt?: unknown };
        }) =>
          Promise.resolve(
            disclosures
              .filter((d) => where.vaultId.in.includes(d.vaultId))
              .filter((d) => d.publishedAt !== null)
              .sort((a, b) => b.version - a.version),
          ),
      ),
    },
    vaultDisclosureAcknowledgment: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            userId_vaultId_version: {
              userId: string;
              vaultId: string;
              version: number;
            };
          };
        }) =>
          Promise.resolve(
            ackStore.get(ackKey(where.userId_vaultId_version)) ?? null,
          ),
      ),
      findMany: jest.fn(
        ({ where }: { where: { userId: string; vaultId: { in: string[] } } }) =>
          Promise.resolve(
            [...ackStore.values()].filter(
              (a) =>
                a.userId === where.userId &&
                where.vaultId.in.includes(a.vaultId),
            ),
          ),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: {
            userId_vaultId_version: {
              userId: string;
              vaultId: string;
              version: number;
            };
          };
          create: Omit<AckRow, 'id' | 'acknowledgedAt'>;
        }) => {
          const key = ackKey(where.userId_vaultId_version);
          const existing = ackStore.get(key);
          if (existing) return Promise.resolve(existing);
          const row: AckRow = {
            id: `ack-${++seq}`,
            acknowledgedAt: new Date('2026-10-06T12:00:00.000Z'),
            ...create,
          };
          ackStore.set(key, row);
          return Promise.resolve(row);
        },
      ),
    },
  };

  return {
    prisma,
    ackStore,
    service: new DisclosureService(prisma as unknown as never),
  };
}

const published = (
  vaultId: string,
  version: number,
  risks: unknown[] = [{ code: 'SMART_CONTRACT', severity: 'HIGH' }],
): DisclosureRow => ({
  id: `${vaultId}-v${version}`,
  vaultId,
  version,
  risks,
  sections: null,
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
});

const draft = (vaultId: string, version: number): DisclosureRow => ({
  ...published(vaultId, version),
  publishedAt: null,
});

describe('DisclosureService', () => {
  describe('resolving the current version', () => {
    it('returns the highest published version', async () => {
      const { service } = createStore([
        published('vault-a', 1),
        published('vault-a', 3),
        published('vault-a', 2),
      ]);

      await expect(service.findCurrent('vault-a')).resolves.toMatchObject({
        version: 3,
      });
    });

    it('ignores a draft, even when it is the highest version', async () => {
      const { service } = createStore([
        published('vault-a', 1),
        draft('vault-a', 2),
      ]);

      await expect(service.findCurrent('vault-a')).resolves.toMatchObject({
        version: 1,
      });
    });

    it('returns null when nothing is published', async () => {
      const { service } = createStore([draft('vault-a', 1)]);

      await expect(service.findCurrent('vault-a')).resolves.toBeNull();
    });

    it('throws for a vault with no disclosure at all', async () => {
      const { service } = createStore();

      await expect(service.getCurrentOrThrow('vault-a')).rejects.toThrow(
        /no published risk disclosure/,
      );
    });

    it('caches the lookup, because it sits on the deposit path', async () => {
      const { service, prisma } = createStore([published('vault-a', 1)]);

      await service.findCurrent('vault-a');
      await service.findCurrent('vault-a');

      expect(prisma.vaultDisclosure.findFirst).toHaveBeenCalledTimes(1);
    });

    it('invalidate() lets a freshly published version take effect', async () => {
      const { service, prisma } = createStore([published('vault-a', 1)]);

      await service.findCurrent('vault-a');
      service.invalidate('vault-a');
      await service.findCurrent('vault-a');

      expect(prisma.vaultDisclosure.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('recording consent', () => {
    it('persists the version and a timestamp', async () => {
      const { service, ackStore } = createStore([published('vault-a', 2)]);

      const result = await service.acknowledge({
        userId: 'user-1',
        vaultId: 'vault-a',
      });

      expect(result).toMatchObject({ vaultId: 'vault-a', version: 2 });
      expect(result.acknowledgedAt).toBeInstanceOf(Date);
      expect(ackStore.get('user-1|vault-a|2')).toBeDefined();
    });

    it('stores the audit context it was given', async () => {
      const { service, ackStore } = createStore([published('vault-a', 1)]);

      await service.acknowledge({
        userId: 'user-1',
        vaultId: 'vault-a',
        context: { appVersion: '1.4.0', mode: 'lite', shownCodes: ['DEPEG'] },
      });

      expect(ackStore.get('user-1|vault-a|1')?.context).toEqual({
        appVersion: '1.4.0',
        mode: 'lite',
        shownCodes: ['DEPEG'],
      });
    });

    it('is idempotent and keeps the first timestamp', async () => {
      // Re-posting must not rewrite when consent was given: that moment is the
      // record.
      const { service } = createStore([published('vault-a', 1)]);

      const first = await service.acknowledge({
        userId: 'user-1',
        vaultId: 'vault-a',
      });
      const second = await service.acknowledge({
        userId: 'user-1',
        vaultId: 'vault-a',
      });

      expect(second.acknowledgedAt).toEqual(first.acknowledgedAt);
    });

    it('rejects consent for a version that is no longer current', async () => {
      // Guards the race where a version is published while the sheet is open:
      // accepting the text actually read is the whole point.
      const { service } = createStore([
        published('vault-a', 1),
        published('vault-a', 2),
      ]);

      await expect(
        service.acknowledge({
          userId: 'user-1',
          vaultId: 'vault-a',
          expectedVersion: 1,
        }),
      ).rejects.toThrow(/no longer current/);
    });

    it('accepts when the submitted version matches', async () => {
      const { service } = createStore([published('vault-a', 2)]);

      await expect(
        service.acknowledge({
          userId: 'user-1',
          vaultId: 'vault-a',
          expectedVersion: 2,
        }),
      ).resolves.toMatchObject({ version: 2 });
    });
  });

  describe('versioning re-triggers consent', () => {
    it('stops satisfying the requirement once a newer version is published', async () => {
      const disclosures = [published('vault-a', 1)];
      const { service } = createStore(disclosures);

      await service.acknowledge({ userId: 'user-1', vaultId: 'vault-a' });
      await expect(
        service.hasAcknowledgedCurrent('user-1', 'vault-a'),
      ).resolves.toMatchObject({ acknowledged: true });

      disclosures.push(published('vault-a', 2));
      service.invalidate('vault-a');

      await expect(
        service.hasAcknowledgedCurrent('user-1', 'vault-a'),
      ).resolves.toMatchObject({
        acknowledged: false,
        current: { version: 2 },
      });
    });
  });

  describe('separation by user and by vault', () => {
    it('one user accepting does not satisfy another user', async () => {
      const { service } = createStore([published('vault-a', 1)]);

      await service.acknowledge({ userId: 'user-a', vaultId: 'vault-a' });

      await expect(
        service.hasAcknowledgedCurrent('user-a', 'vault-a'),
      ).resolves.toMatchObject({ acknowledged: true });
      await expect(
        service.hasAcknowledgedCurrent('user-b', 'vault-a'),
      ).resolves.toMatchObject({ acknowledged: false });
    });

    it('accepting one vault does not satisfy another vault', async () => {
      const { service } = createStore([
        published('vault-a', 1),
        published('vault-b', 1),
      ]);

      await service.acknowledge({ userId: 'user-a', vaultId: 'vault-a' });

      await expect(
        service.hasAcknowledgedCurrent('user-a', 'vault-a'),
      ).resolves.toMatchObject({ acknowledged: true });
      await expect(
        service.hasAcknowledgedCurrent('user-a', 'vault-b'),
      ).resolves.toMatchObject({ acknowledged: false });
    });
  });

  describe('batch lookups for the vault list', () => {
    it('groups acknowledged versions per vault in one query', async () => {
      const { service, prisma } = createStore([
        published('vault-a', 1),
        published('vault-b', 1),
      ]);
      await service.acknowledge({ userId: 'user-a', vaultId: 'vault-a' });
      await service.acknowledge({ userId: 'user-a', vaultId: 'vault-b' });

      const byVault = await service.acknowledgedVersionsFor('user-a', [
        'vault-a',
        'vault-b',
      ]);

      expect(byVault.get('vault-a')).toEqual(new Set([1]));
      expect(byVault.get('vault-b')).toEqual(new Set([1]));
      expect(
        prisma.vaultDisclosureAcknowledgment.findMany,
      ).toHaveBeenCalledTimes(1);
    });

    it('returns the current version per vault, highest first wins', async () => {
      const { service } = createStore([
        published('vault-a', 1),
        published('vault-a', 4),
        published('vault-b', 2),
      ]);

      const byVault = await service.currentVersionsFor(['vault-a', 'vault-b']);

      expect(byVault.get('vault-a')?.version).toBe(4);
      expect(byVault.get('vault-b')?.version).toBe(2);
    });

    it('does not query at all for an empty list', async () => {
      const { service, prisma } = createStore();

      await expect(service.currentVersionsFor([])).resolves.toEqual(new Map());
      await expect(service.acknowledgedVersionsFor('u', [])).resolves.toEqual(
        new Map(),
      );
      expect(prisma.vaultDisclosure.findMany).not.toHaveBeenCalled();
      expect(
        prisma.vaultDisclosureAcknowledgment.findMany,
      ).not.toHaveBeenCalled();
    });
  });
});
