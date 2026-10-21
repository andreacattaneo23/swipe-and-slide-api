import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { APPEAL_MAX_LENGTH } from '../../domain/safety/appeals.service';
import {
  MAX_ATTACHED_MESSAGES,
  REPORT_REASONS,
  ReportReason,
  ReportSource,
} from '../../domain/safety/reports.service';

export class ReportDto {
  @ApiProperty({ description: 'Persona segnalata' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: REPORT_REASONS, description: 'Motivi di D71' })
  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  @ApiProperty({ enum: ['feed', 'match', 'chat'] })
  @IsIn(['feed', 'match', 'chat'])
  source: ReportSource;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Testo breve, obbligatorio per "altro"' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({
    description: 'Match da cui si segnala (anche chiuso da meno di 30 giorni)',
  })
  @IsOptional()
  @IsUUID()
  matchId?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_ATTACHED_MESSAGES,
    description: 'Messaggi della chat da allegare (solo di quel match)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHED_MESSAGES)
  @IsUUID('all', { each: true })
  messageIds?: string[];

  @ApiPropertyOptional({ description: 'Contiene minacce o contenuti illegali: esame entro 24 ore' })
  @IsOptional()
  @IsBoolean()
  containsThreats?: boolean;
}

export class ReceivedDto {
  @ApiProperty({ enum: ['received'], description: 'Conferma neutra, uguale per ogni motivo' })
  status: 'received';
}

export class ReportOutcomeDto {
  @ApiProperty() id: string;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({
    nullable: true,
    type: Date,
    description: 'Esito generico (D113): l’app mostra sempre lo stesso testo',
  })
  reviewedAt: Date | null;
}

export class AppealStatusDto {
  @ApiProperty({ enum: ['pending', 'accepted', 'rejected'] }) status: string;
  @ApiProperty() submittedAt: Date;
}

export class MySanctionDto {
  @ApiProperty() id: string;
  @ApiProperty({
    enum: ['warning', 'disciplinary_suspension', 'precautionary_suspension', 'expulsion'],
  })
  type: string;
  @ApiPropertyOptional({ nullable: true, type: String }) severeCase: string | null;
  @ApiProperty({
    description: 'Motivazione della decisione (D75); `possible_minor` per la cautelativa',
  })
  explanation: string;
  @ApiProperty() startsAt: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) endsAt: Date | null;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional({ nullable: true, type: Date }) appealDeadlineAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: AppealStatusDto }) appeal: AppealStatusDto | null;
}

export class AppealDto {
  @ApiProperty({ maxLength: APPEAL_MAX_LENGTH })
  @IsString()
  @Length(1, APPEAL_MAX_LENGTH)
  text: string;
}

export class CodeAppealDto extends AppealDto {
  @ApiProperty({ description: 'Codice del collegamento ricevuto all’email personale' })
  @IsString()
  @Length(16, 64)
  code: string;
}

export class AgeVerificationStatusDto {
  @ApiProperty() requested: boolean;
  @ApiPropertyOptional({ nullable: true, type: Date }) requestedAt: Date | null;
  @ApiProperty() uploaded: boolean;
}

export class UploadUrlDto {
  @ApiProperty({ description: 'URL firmato per caricare il documento (PUT), pochi minuti' })
  uploadUrl: string;
  @ApiProperty() expiresAt: Date;
  @ApiProperty({ description: 'Da inviare alla conferma del caricamento' }) key: string;
}

export class UploadConfirmationDto {
  @ApiProperty()
  @IsString()
  @Length(10, 200)
  key: string;
}

export class ResubmissionDto {
  @ApiProperty() attempt: number;
  @ApiProperty() dueAt: Date;
}

export class WaitlistRequestDto {
  @ApiProperty({ example: 'studio-esempio.it', description: 'Dominio dell’email aziendale' })
  @IsString()
  @Length(3, 253)
  domain: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  suggestedName?: string;

  @ApiProperty({ description: 'Email di contatto, meglio la personale (P13)' })
  @IsString()
  @Length(3, 260)
  contactEmail: string;
}

export class WaitlistVerificationDto {
  @ApiProperty()
  @IsString()
  @Length(3, 260)
  contactEmail: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
