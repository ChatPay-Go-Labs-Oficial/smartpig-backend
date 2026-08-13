import { Injectable, NotFoundException } from '@nestjs/common';
import { AppPlatform } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { UpdateAppVersionConfigDto } from './dto/update-app-version-config.dto';

@Injectable()
export class AppConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getByPlatform(platform: AppPlatform) {
    const config = await this.prisma.appVersionConfig.findUnique({
      where: { platform },
    });
    if (!config) {
      throw new NotFoundException(`No version config for platform ${platform}`);
    }
    return config;
  }

  async listAll() {
    return this.prisma.appVersionConfig.findMany();
  }

  async update(platform: AppPlatform, dto: UpdateAppVersionConfigDto) {
    return this.prisma.appVersionConfig.update({
      where: { platform },
      data: dto,
    });
  }
}
