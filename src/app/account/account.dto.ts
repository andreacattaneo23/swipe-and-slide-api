import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { EmailDto } from '../auth/auth.dto';

export class CodeDto {
  @ApiProperty({ example: '123456', description: 'Codice OTP di 6 cifre (D136)' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class ConfirmationCodeRequestDto {
  @ApiProperty({
    enum: ['company_change', 'access_change'],
    description: 'Per che cosa si conferma l’identità con il codice all’email personale',
  })
  @IsIn(['company_change', 'access_change'])
  purpose: 'company_change' | 'access_change';
}

export class ConfirmationDto extends CodeDto {
  @ApiProperty({ enum: ['company_change', 'access_change'] })
  @IsIn(['company_change', 'access_change'])
  purpose: 'company_change' | 'access_change';
}

export class WorkEmailVerifyDto extends EmailDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @ApiProperty({ description: 'Versione del testo della dichiarazione P7 accettata (D136)' })
  @IsString()
  @Length(1, 40)
  declarationVersion: string;
}

export class CompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class WorkEmailResultDto {
  @ApiProperty({ enum: ['sameCompany', 'changed'] })
  result: string;

  @ApiProperty({ type: CompanyDto, description: 'La propria azienda attuale' })
  company: CompanyDto;

  @ApiProperty({ description: 'Chiedere se riattivare l’open space (D197)' })
  openSpacePrompt: boolean;

  @ApiProperty({ description: 'L’azienda lasciata è entrata nelle aziende escluse (D176)' })
  leftCompanyExcluded: boolean;

  @ApiProperty({ description: 'La nuova azienda è uscita dalle aziende escluse (D158)' })
  newCompanyUnexcluded: boolean;

  @ApiProperty({ description: 'Nuovo token di accesso con l’ambito aggiornato' })
  accessToken: string;

  @ApiProperty()
  expiresIn: number;

  @ApiProperty()
  scope: string;
}

export class AccessTokenDto {
  @ApiProperty({ description: 'Nuovo token di accesso con l’ambito aggiornato' })
  accessToken: string;

  @ApiProperty()
  expiresIn: number;

  @ApiProperty({ enum: ['full', 'registration', 'approval', 'restore', 'limited'] })
  scope: string;
}

export class AccessInfoDto {
  @ApiPropertyOptional({ enum: ['apple', 'google', 'email'], nullable: true })
  provider: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Mai mostrata ad altri' })
  personalEmail: string | null;

  @ApiProperty({ description: 'Email nascosta di Apple (`settings.access.relay`)' })
  isPrivateRelay: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Email aziendale attiva' })
  workEmail: string | null;

  @ApiProperty({ description: 'Accesso con l’email aziendale (D233)' })
  workEmailSignIn: boolean;
}

export class AccessUpdateDto {
  @ApiProperty()
  @IsBoolean()
  workEmailSignIn: boolean;
}

export class AccessMethodDto {
  @ApiProperty({ enum: ['apple', 'google', 'email'] })
  @IsIn(['apple', 'google', 'email'])
  provider: 'apple' | 'google' | 'email';

  @ApiPropertyOptional({ description: 'Con Apple o Google: token d’identità' })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  identityToken?: string;

  @ApiPropertyOptional({ description: 'Con Apple o Google: nonce di `POST /auth/nonce`' })
  @IsOptional()
  @IsString()
  @Length(20, 100)
  nonce?: string;

  @ApiPropertyOptional({ description: 'Con l’email: nuova email personale' })
  @IsOptional()
  @IsString()
  @Length(3, 260)
  email?: string;

  @ApiPropertyOptional({ description: 'Con l’email: codice inviato alla nuova email' })
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;
}

export class PersonalEmailVerifyDto extends EmailDto {
  @ApiProperty({ description: 'Codice inviato all’email personale di adesso' })
  @Matches(/^\d{6}$/)
  oldCode: string;

  @ApiProperty({ description: 'Codice inviato alla nuova email personale' })
  @Matches(/^\d{6}$/)
  newCode: string;
}

export class ConsentDto {
  @ApiProperty({ enum: ['art9', 'terms', 'p7_declaration'] })
  type: string;

  @ApiProperty()
  textVersion: string;

  @ApiProperty()
  givenAt: Date;

  @ApiPropertyOptional({ nullable: true })
  revokedAt: Date | null;
}

export class DeletionStateDto {
  @ApiProperty()
  deletionRequestedAt: Date;

  @ApiProperty({ description: 'Cancellazione definitiva (più 7 giorni, D83)' })
  deletionFinalAt: Date;

  @ApiProperty({ description: 'Dalla revoca del consenso art. 9 (`consent.revoked.*`)' })
  consentRevoked: boolean;

  @ApiProperty({ description: 'Nuovo token di accesso, con l’ambito `limited`' })
  accessToken: string;

  @ApiProperty()
  expiresIn: number;

  @ApiProperty()
  scope: string;
}

export class DataExportDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['pending', 'ready', 'failed', 'expired'] })
  status: string;

  @ApiProperty()
  requestedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  readyAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'URL firmato di pochi minuti' })
  downloadUrl: string | null;
}

export class WebDeletionAcceptedDto {
  @ApiProperty({
    example: 'sent',
    description: 'Risposta uguale per ogni indirizzo: il codice va all’email personale (D83)',
  })
  status: 'sent';
}

export class WebDeletionResultDto {
  @ApiProperty({ example: 'requested' })
  status: 'requested';

  @ApiProperty({ description: 'Cancellazione definitiva, annullabile accedendo all’app' })
  deletionFinalAt: Date;
}
