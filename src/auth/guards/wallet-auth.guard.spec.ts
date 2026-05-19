import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WalletAuthGuard } from './wallet-auth.guard';

describe('WalletAuthGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  function mockContext(handler: () => void, isPublic: boolean): ExecutionContext {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    return {
      getHandler: () => handler,
      getClass: () => ({}),
      getType: () => 'http',
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({} as never),
      switchToWs: () => ({} as never),
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() }),
        getNext: () => jest.fn(),
      }),
    } as unknown as ExecutionContext;
  }

  it('should return true immediately for public routes', () => {
    const guard = new WalletAuthGuard(reflector);
    const handler = jest.fn();

    const result = guard.canActivate(mockContext(handler, true));
    expect(result).toBe(true);
  });

  it('should query reflector with correct metadata key', () => {
    const guard = new WalletAuthGuard(reflector);
    const handler = jest.fn();

    const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    guard.canActivate(mockContext(handler, true));

    expect(spy).toHaveBeenCalledWith(expect.any(String), [
      handler,
      expect.any(Object),
    ]);
  });
});
