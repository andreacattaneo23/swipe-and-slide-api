import { REJECTION_REASONS } from '../../domain/approvals/approvals.service';
import { MySanctionDto } from '../safety/safety.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OwnCompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class ExcludedCompaniesNoticeDto {
  @ApiPropertyOptional({
    type: OwnCompanyDto,
    nullable: true,
    description: 'Azienda lasciata, entrata nelle aziende escluse (`excluded.notice.company`)',
  })
  leftCompany: OwnCompanyDto | null;

  @ApiPropertyOptional({
    type: OwnCompanyDto,
    nullable: true,
    description: 'Nuova azienda tolta dalle aziende escluse (`excluded.removedCurrent`)',
  })
  removedCurrentCompany: OwnCompanyDto | null;
}

export class MeDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Nome del profilo' })
  firstName: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: "Email personale attiva (D224): solo all'utente stesso",
  })
  personalEmail: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: "Email aziendale attiva, mascherata (D90, D137): solo all'utente stesso",
  })
  workEmail: string | null;

  @ApiProperty({
    enum: ['photos', 'firstName', 'gender', 'interestedIn', 'homeCity'],
    isArray: true,
    description: 'Ciò che manca al profilo per entrare nel feed (D51, D109)',
  })
  missing: ('photos' | 'firstName' | 'gender' | 'interestedIn' | 'homeCity')[];

  @ApiPropertyOptional({
    nullable: true,
    type: MySanctionDto,
    description: 'Sanzione in corso, la più recente (D75, D113); le altre in `GET /me/sanctions`',
  })
  sanction: MySanctionDto | null;

  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['registering', 'pending_approval', 'active', 'reverifying', 'suspended'] })
  status: string;

  @ApiProperty({ enum: ['full', 'registration', 'approval', 'restore', 'limited'] })
  scope: string;

  @ApiProperty({
    enum: ['apple', 'google', 'email'],
    nullable: true,
    description: 'Modo di accesso (D224)',
  })
  signInMethod: string | null;

  @ApiPropertyOptional({
    type: OwnCompanyDto,
    nullable: true,
    description: 'Solo la propria azienda',
  })
  company: OwnCompanyDto | null;

  @ApiProperty({ description: "Stato del proprio Open space, solo per l'utente stesso (D157)" })
  openSpaceEnabled: boolean;

  @ApiProperty({ description: 'Dopo un cambio di azienda: chiedere se riattivarlo' })
  openSpacePrompt: boolean;

  @ApiPropertyOptional({ nullable: true })
  reverificationDueAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cancellazione prevista (rifiuto non ripresentato, D142)',
  })
  deletionScheduledAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ripensamento della cancellazione in corso (D83)',
  })
  deletionRequestedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Fine dei 7 giorni per completare la registrazione',
  })
  registrationExpiresAt: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Cancellazione definitiva prevista (D83)' })
  deletionFinalAt: Date | null;

  @ApiProperty({ description: 'Il ripensamento viene dalla revoca del consenso art. 9' })
  consentRevoked: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Modalità OOO attiva da (D81)' })
  oooSince: Date | null;

  @ApiPropertyOptional({
    type: ExcludedCompaniesNoticeDto,
    nullable: true,
    description: 'Avviso da mostrare una volta dopo un cambio azienda (D176)',
  })
  excludedCompaniesNotice: ExcludedCompaniesNoticeDto | null;
}

export class ApprovalStatusDto {
  @ApiProperty({ enum: ['none', 'pending', 'late', 'rejected', 'blocked', 'approved'] })
  status: 'none' | 'pending' | 'late' | 'rejected' | 'blocked' | 'approved';

  @ApiPropertyOptional({ nullable: true })
  dueAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: REJECTION_REASONS,
    description: 'Codice del motivo del rifiuto, uguale nel backoffice (D142)',
  })
  reason: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Motivazione, visibile solo qui (D142)' })
  explanation: string | null;

  @ApiProperty({ description: 'Tentativi rimasti ("Ti restano 2 tentativi")' })
  attemptsLeft: number;
}
