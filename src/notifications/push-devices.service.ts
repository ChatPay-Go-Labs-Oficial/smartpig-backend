import { Injectable } from '@nestjs/common';
import { AppPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';

/**
 * Teto de aparelhos por conta. Sem ele, um cliente poderia registrar tokens
 * sem fim e cada push viraria centenas de mensagens. Acima do teto, os que não
 * aparecem há mais tempo são removidos.
 */
export const MAX_DEVICES_PER_USER = 10;

export interface RegisterDeviceInput {
  token: string;
  platform: 'ios' | 'android';
  appVersion?: string;
}

const PLATFORM: Record<RegisterDeviceInput['platform'], AppPlatform> = {
  ios: AppPlatform.IOS,
  android: AppPlatform.ANDROID,
};

@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert pelo token. Se o token já pertence a outro usuário, passa a ser
   * deste: o push vai para quem está logado no aparelho agora.
   */
  async register(userId: string, input: RegisterDeviceInput): Promise<void> {
    const fields = {
      userId,
      platform: PLATFORM[input.platform],
      appVersion: input.appVersion ?? null,
      lastSeenAt: new Date(),
      disabledAt: null,
    };

    try {
      await this.prisma.pushDevice.upsert({
        where: { token: input.token },
        create: { token: input.token, ...fields },
        update: fields,
      });
    } catch (error) {
      // Dois registros simultâneos do mesmo token novo: o upsert do Prisma não
      // é atômico e o segundo bate no índice único. A linha já existe; atualiza.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.prisma.pushDevice.update({
          where: { token: input.token },
          data: fields,
        });
      } else {
        throw error;
      }
    }

    await this.pruneExcess(userId);
  }

  /** Remove só se o token for do usuário atual. Idempotente. */
  async remove(userId: string, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { token, userId } });
  }

  private async pruneExcess(userId: string): Promise<void> {
    const excess = await this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      skip: MAX_DEVICES_PER_USER,
      select: { id: true },
    });
    if (excess.length === 0) return;

    await this.prisma.pushDevice.deleteMany({
      where: { id: { in: excess.map((d) => d.id) }, userId },
    });
  }
}
