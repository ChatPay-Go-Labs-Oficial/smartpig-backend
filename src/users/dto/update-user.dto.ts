import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiProperty({ description: 'Display name', example: 'João Silva', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  name?: string;

  @ApiProperty({ description: 'Email address', example: 'joao@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: 'Avatar URL', required: false })
  @IsUrl()
  @IsOptional()
  avatarUrl?: string;
  
  @ApiProperty({ description: 'Onboarding status', example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isOnboarded?: boolean;
}
