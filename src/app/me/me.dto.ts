import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OwnCompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class MeDto {
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
}

export class ApprovalStatusDto {
  @ApiProperty({ enum: ['none', 'pending', 'late', 'rejected', 'blocked', 'approved'] })
  status: 'none' | 'pending' | 'late' | 'rejected' | 'blocked' | 'approved';

  @ApiPropertyOptional({ nullable: true })
  dueAt: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Codice del motivo del rifiuto' })
  reason: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Motivazione, visibile solo qui (D142)' })
  explanation: string | null;

  @ApiProperty({ description: 'Tentativi rimasti ("Ti restano 2 tentativi")' })
  attemptsLeft: number;
}
