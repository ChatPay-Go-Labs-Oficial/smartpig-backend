import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not configured — Redis disabled');
      return;
    }
    this.client = new Redis(url, { maxRetriesPerRequest: 3 });
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis disconnected');
    }
  }

  async getAndDeleteNonce(stellarAddress: string): Promise<string | null> {
    if (!this.client) return null;
    const key = `nonce:${stellarAddress}`;
    const nonce = await this.client.get(key);
    if (nonce) {
      await this.client.del(key);
    }
    return nonce;
  }

  async setNonce(
    stellarAddress: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.client) return;
    await this.client.set(`nonce:${stellarAddress}`, nonce, 'EX', ttlSeconds);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  isConnected(): boolean {
    return this.client?.status === 'ready';
  }
}
