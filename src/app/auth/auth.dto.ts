import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class NonceDto {
  @ApiProperty({
    description:
      'Valore casuale a uso singolo: al fornitore la sua impronta SHA-256 (Apple) o il valore (Google)',
  })
  nonce: string;

  @ApiProperty()
  expiresAt: Date;
}

export class EmailDto {
  @ApiProperty({
    example: 'nome@esempio.it',
    maxLength: 254,
    description: 'Normalizzata dal backend (RC-04)',
  })
  @IsString()
  @Length(3, 260)
  email: string;
}

export class VerifyCodeDto extends EmailDto {
  @ApiProperty({ example: '123456', description: 'Codice OTP di 6 cifre (D136)' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class ProviderTokenDto {
  @ApiPropertyOptional({ description: "Token d'identità del fornitore (JWT)" })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  identityToken?: string;

  @ApiPropertyOptional({ description: 'Nonce emesso da `POST /auth/nonce`, in chiaro' })
  @IsOptional()
  @IsString()
  @Length(20, 100)
  nonce?: string;

  @ApiPropertyOptional({
    description: 'Codice di autorizzazione per il server (solo per la revoca, Proposta 7)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  authorizationCode?: string;

  @ApiPropertyOptional({
    description: 'Solo in registrazione: ticket di un accesso senza account (Proposta 5)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  registrationTicket?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  refreshToken: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    enum: ['device', 'all'],
    default: 'device',
    description: '"Esci da tutti i dispositivi" con `all`',
  })
  @IsOptional()
  @IsIn(['device', 'all'])
  from?: 'device' | 'all';
}

export class SessionDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Opaco, 30 giorni, sostituito a ogni rinnovo' })
  refreshToken: string;

  @ApiProperty({ example: 900 })
  expiresIn: number;

  @ApiProperty({ enum: ['full', 'registration', 'approval', 'restore', 'limited'] })
  scope: string;
}

export class SignInResultDto {
  @ApiProperty({ enum: ['signedIn', 'noAccount', 'existingAccount', 'created'] })
  result: 'signedIn' | 'noAccount' | 'existingAccount' | 'created';

  @ApiPropertyOptional({ type: SessionDto })
  session?: SessionDto;

  @ApiPropertyOptional({ description: 'Con `noAccount` da Apple o Google: valido 10 minuti' })
  registrationTicket?: string;
}

export class AcceptedDto {
  @ApiProperty({
    example: 'sent',
    description: 'Risposta uguale per ogni indirizzo (testo `signIn.neutral`)',
  })
  status: 'sent';
}
