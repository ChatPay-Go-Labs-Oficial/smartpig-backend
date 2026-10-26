import { IsString } from 'class-validator';

export class CreateUsernameDto {
  @IsString()
  username: string;
}
