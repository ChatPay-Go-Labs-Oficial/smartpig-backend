import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppPlatform } from '@prisma/client';
import { Public } from '../auth/privy/public.decorator';
import { Admin } from '../auth/privy/admin.decorator';
import { AppConfigService } from './app-config.service';
import { UpdateAppVersionConfigDto } from './dto/update-app-version-config.dto';

function parsePlatform(raw: string): AppPlatform {
  const normalized = raw?.toUpperCase();
  if (normalized !== 'IOS' && normalized !== 'ANDROID') {
    throw new BadRequestException('platform must be "ios" or "android"');
  }
  return normalized as AppPlatform;
}

@ApiTags('App Config')
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('version')
  @Public()
  @ApiOperation({
    summary:
      'Get current app version config (min/recommended version + store URL)',
  })
  @ApiQuery({
    name: 'platform',
    required: false,
    enum: ['ios', 'android'],
    description: 'Se omitido, retorna as duas plataformas',
  })
  @ApiResponse({
    status: 200,
    description:
      'Version config for the given platform, or an array with both.',
  })
  async getVersion(@Query('platform') platform?: string) {
    if (!platform) return this.appConfigService.listAll();
    return this.appConfigService.getByPlatform(parsePlatform(platform));
  }

  @Patch('version/:platform')
  @Admin()
  @ApiOperation({
    summary:
      'Update min/recommended version and store URL for a platform (admin only)',
  })
  async updateVersion(
    @Param('platform') platform: string,
    @Body() dto: UpdateAppVersionConfigDto,
  ) {
    return this.appConfigService.update(parsePlatform(platform), dto);
  }
}
