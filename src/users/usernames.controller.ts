import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsernamesService } from './usernames.service';

// Exact lookups only, authenticated by the existing global Privy guard.
@Controller('usernames')
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class UsernamesController {
  constructor(private readonly usernames: UsernamesService) {}

  @Get(':username/availability')
  availability(@Param('username') username: string) {
    return this.usernames.availability(username);
  }

  @Get(':username')
  resolve(@Param('username') username: string) {
    return this.usernames.resolve(username);
  }
}
