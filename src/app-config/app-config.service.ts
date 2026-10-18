import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppPlatform } from '@prisma/client';
import { PrismaService } from '../infra/prisma/prisma.service';
import { UpdateAppVersionConfigDto } from './dto/update-app-version-config.dto';
import {
  assetIdOf,
  readAssetRegistry,
  type AssetDefinition,
} from '../config/asset-registry';

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly assets: AssetDefinition[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // Resolved once at boot: an invalid registry should stop the app, not surface
    // as a confusing 500 on the first request that happens to need an asset.
    this.assets = readAssetRegistry(
      this.config.get<string>('DEFINDEX_NETWORK', 'testnet'),
      this.config.get<string>('STELLAR_ASSETS_JSON'),
    );
    this.logger.log(
      `Asset registry loaded: ${this.assets.map((a) => a.symbol).join(', ')}`,
    );
  }

  /**
   * The assets the app may encounter, with how to display each one.
   *
   * Presentation lives here rather than in the app so that adding an asset — or
   * renaming one in Lite mode — does not require a store release. `issuer` and
   * `assetId` are included because the client needs them to match balances and
   * to build a trustline; all of it is public chain data.
   */
  listAssets() {
    return this.assets.map((a) => ({
      symbol: a.symbol,
      code: a.code,
      issuer: a.issuer,
      assetId: assetIdOf(a),
      contractId: a.contractId,
      decimals: a.decimals,
      kind: a.kind,
      displayPrefix: a.displayPrefix,
      displaySuffix: a.displaySuffix,
      liteSymbol: a.liteSymbol,
      liteName: a.liteName,
      liteDecimals: a.liteDecimals,
      proDecimals: a.proDecimals,
      maxSlippageBps: a.maxSlippageBps,
      isFundingAsset: a.isFundingAsset,
    }));
  }

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
