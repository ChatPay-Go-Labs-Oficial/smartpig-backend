import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { Expo } from 'expo-server-sdk';

export const PUSH_PLATFORMS = ['ios', 'android'] as const;

/** Token do Expo Push (`ExponentPushToken[...]`), validado pelo próprio SDK. */
export function IsExpoPushToken(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isExpoPushToken',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && Expo.isExpoPushToken(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be an Expo push token`;
        },
      },
    });
  };
}

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Token do Expo Push Service',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @MaxLength(256)
  @IsExpoPushToken()
  token: string;

  @ApiProperty({ enum: PUSH_PLATFORMS })
  @IsIn(PUSH_PLATFORMS)
  platform: (typeof PUSH_PLATFORMS)[number];

  @ApiPropertyOptional({ example: '1.0.12' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[0-9A-Za-z.+-]+$/)
  appVersion?: string;
}
