import { IsString } from 'class-validator';

export class RegisterUsernameDto {
  @IsString()
  username: string;
}
