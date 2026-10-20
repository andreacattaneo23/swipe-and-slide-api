import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { SessionDto } from '../auth/auth.dto';

export const REGISTRATION_STEPS = [
  'account',
  'birthDate',
  'workEmail',
  'consent',
  'profile',
  'openSpace',
  'privacy',
] as const;
export type RegistrationStep = (typeof REGISTRATION_STEPS)[number];

export class RegistrationStateDto {
  @ApiProperty({ enum: REGISTRATION_STEPS, isArray: true })
  completedSteps: RegistrationStep[];

  @ApiProperty({
    enum: [...REGISTRATION_STEPS, 'complete'],
    description: 'Passo successivo; "privacy" è facoltativo',
  })
  nextStep: RegistrationStep | 'complete';

  @ApiProperty({ description: "Fine dei 7 giorni dall'inizio (D82)" })
  expiresAt: Date;
}

export class TextVersionDto {
  @ApiProperty({ example: '2026-10-01', description: 'Versione del testo mostrato e accettato' })
  @IsString()
  @Length(1, 40)
  textVersion: string;
}

export class BirthDateDto {
  @ApiProperty({ example: '1994-05-12', description: 'Data di nascita (mai mostrata, D47)' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate: string;

  @ApiProperty({ description: 'Accettazione dei termini, casella non preselezionata' })
  @IsBoolean()
  @Equals(true, { message: 'registration.terms.error' })
  termsAccepted: boolean;

  @ApiProperty({ example: '2026-10-01' })
  @IsString()
  @Length(1, 40)
  termsVersion: string;
}

export class WorkEmailDto {
  @ApiProperty({
    example: 'nome.cognome@azienda.it',
    description: 'Normalizzata dal backend (RC-04)',
  })
  @IsString()
  @Length(3, 260)
  email: string;

  @ApiProperty({ description: 'Dichiarazione P7 (D136), casella non preselezionata' })
  @IsBoolean()
  @Equals(true, { message: 'registration.declaration.error' })
  declarationAccepted: boolean;

  @ApiProperty({ example: '2026-10-01' })
  @IsString()
  @Length(1, 40)
  declarationVersion: string;
}

export class WorkEmailVerifyDto extends WorkEmailDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class ConsentDto extends TextVersionDto {
  @ApiProperty({ description: 'Consenso esplicito art. 9 (D33), casella separata' })
  @IsBoolean()
  @Equals(true, { message: 'registration.consent.error' })
  accepted: boolean;
}

export class RegistrationProfileDto {
  @ApiProperty({ maxLength: 30 })
  @IsString()
  @Length(1, 30)
  firstName: string;

  @ApiPropertyOptional({ maxLength: 40, description: 'Visibile solo dopo il match (D56)' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  lastName?: string;

  @ApiProperty({ enum: ['woman', 'man', 'non_binary', 'undisclosed'] })
  @IsIn(['woman', 'man', 'non_binary', 'undisclosed'])
  gender: 'woman' | 'man' | 'non_binary' | 'undisclosed';

  @ApiProperty({ enum: ['men', 'women', 'everyone'], description: 'Mai mostrato (D47, D90)' })
  @IsIn(['men', 'women', 'everyone'])
  interestedIn: 'men' | 'women' | 'everyone';

  @ApiProperty({ example: '015146', description: 'Codice ISTAT del comune (D49)' })
  @Matches(/^\d{6}$/)
  homeCityId: string;
}

export class OpenSpaceChoiceDto extends TextVersionDto {
  @ApiProperty({ description: '"Attiva l\'open space" (vero) o "Per ora no" (falso), D156' })
  @IsBoolean()
  enabled: boolean;
}

export class PrivacyDto {
  @ApiProperty({
    type: [String],
    maxItems: 15,
    description: "Aziende escluse, dall'elenco consultabile (D175)",
  })
  @IsArray()
  @ArrayMaxSize(15)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  companyIds: string[];
}

export class CompleteResultDto {
  @ApiProperty({ enum: ['pending_approval'] })
  status: 'pending_approval';

  @ApiProperty({ description: 'Scadenza della revisione a 24 ore (D141)' })
  reviewDueAt: Date;

  @ApiProperty({ description: 'Nuovo token di accesso con ambito `approval`' })
  accessToken: string;

  @ApiProperty()
  expiresIn: number;

  @ApiProperty({ enum: ['approval'] })
  scope: string;
}

export class RegistrationSessionDto {
  @ApiProperty({ enum: ['created', 'existingAccount'] })
  result: 'created' | 'existingAccount';

  @ApiProperty({ type: SessionDto })
  session: SessionDto;
}
