import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { ReflectorService } from './reflector.service';

/**
 * USD prices for the registry's assets.
 *
 * A multi-asset portfolio cannot be added up without them: USDC, EURC and XLM
 * positions are three different units, and a total that sums them raw means
 * nothing.
 */
@Module({
  providers: [ReflectorService, PricingService],
  exports: [PricingService],
})
export class PricingModule {}
