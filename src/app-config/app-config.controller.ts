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
import { AdminOnly } from '../auth/privy/admin-only.decorator';
import { AppConfigService } from './app-config.service';
import { UpdateAppVersionConfigDto } from './dto/update-app-version-config.dto';

function parsePlatform(raw: string): AppPlatform {
  const normalized = raw?.toUpperCase();
  if (normalized !== 'IOS' && normalized !== 'ANDROID') {
    throw new BadRequestException('platform must be "ios" or "android"');
  }
  return normalized;
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

  @Get('assets')
  @Public()
  @ApiOperation({
    summary: 'Assets this deployment supports, with display rules',
    description:
      'Lets the app format a new asset without a store release. Public for the ' +
      'same reason /app-config/version is: the client needs it before auth.',
  })
  @ApiResponse({
    status: 200,
    description: 'Asset registry for the active network.',
  })
  getAssets() {
    return this.appConfigService.listAssets();
  }

  @Patch('version/:platform')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Update min/recommended version and store URL for a platform (admin only)',
    description:
      'Não dispara push. Para avisar quem está numa versão antiga, use ' +
      'POST /admin/notifications/broadcast com type APP_UPDATE_AVAILABLE e ' +
      'maxAppVersion igual ao novo latestVersion.',
  })
  async updateVersion(
    @Param('platform') platform: string,
    @Body() dto: UpdateAppVersionConfigDto,
  ) {
    return this.appConfigService.update(parsePlatform(platform), dto);
  }
}
