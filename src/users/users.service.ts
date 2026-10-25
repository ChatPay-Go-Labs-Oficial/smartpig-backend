import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ExperienceModeValue,
  UpdateExperienceModeDto,
} from './dto/update-experience-mode.dto';
import { VaultEligibilityService } from '../vault-eligibility/vault-eligibility.service';

const userSelect = {
  id: true,
  name: true,
  username: true,
  usernameSetAt: true,
  email: true,
  avatarUrl: true,
  isOnboarded: true,
  experienceMode: true,
  experienceModeUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vaultEligibility: VaultEligibilityService,
  ) {}

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.withEffectiveExperienceMode(user);
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    await this.findOrThrow(id);

    if (dto.email) {
      const taken = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Email already in use');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: userSelect,
    });

    this.logger.log(`User ${id} updated`);
    return this.withEffectiveExperienceMode(updated);
  }

  /**
   * Existing accounts predate the preference and therefore carry null. Keeping
   * null's effective meaning as PRO prevents a rollout from silently changing
   * the vocabulary or deposit flow of an installed client. New accounts are
   * created explicitly as LITE by AuthService.
   */
  async updateExperienceMode(id: string, dto: UpdateExperienceModeDto) {
    await this.findOrThrow(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        experienceMode: dto.mode,
        experienceModeUpdatedAt: new Date(),
      },
      select: userSelect,
    });

    if (dto.mode === 'LITE') {
      await this.vaultEligibility.refreshUnlocksForUser(id);
    }

    this.logger.log(`User ${id} selected ${dto.mode} experience mode`);
    return this.withEffectiveExperienceMode(updated);
  }

  private withEffectiveExperienceMode<T extends { experienceMode: unknown }>(
    user: T,
  ): Omit<T, 'experienceMode'> & { experienceMode: ExperienceModeValue } {
    return {
      ...user,
      experienceMode: (user.experienceMode ?? 'PRO') as ExperienceModeValue,
    };
  }

  private async findOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }
}
