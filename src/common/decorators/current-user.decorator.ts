import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request: Record<string, unknown> = ctx.switchToHttp().getRequest();
    const user = request['user'] as Record<string, unknown> | undefined;
    return user?.['userId'] as string;
  },
);
