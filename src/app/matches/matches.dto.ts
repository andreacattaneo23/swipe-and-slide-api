import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class MatchPersonDto {
  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional({ nullable: true, description: 'Solo nel match attivo (D56)' })
  lastName?: string | null;

  @ApiPropertyOptional({
    description: "Nome dell'azienda attuale, solo nel match attivo (D30, D107)",
  })
  companyName?: string;

  @ApiPropertyOptional({ nullable: true, description: 'URL firmato della foto principale' })
  photo?: string | null;
}

/**
 * Match nell'elenco e nel dettaglio (architettura, "Match: creazione, scadenza e chiusura"):
 * `paused` è "Conversazione momentaneamente sospesa" (D82), `unavailable` "match non più
 * disponibile", senza alcun dato dell'altra persona né motivo (RC-22, RC-64).
 */
export class MatchDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['active', 'paused', 'unavailable'] })
  state: 'active' | 'paused' | 'unavailable';

  @ApiPropertyOptional({ type: MatchPersonDto })
  person?: MatchPersonDto;

  @ApiPropertyOptional({ description: 'Almeno un messaggio (D107)' })
  chatStarted?: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'Deadline dei 7 giorni (D62)',
  })
  deadlineAt?: string | null;

  @ApiPropertyOptional({ description: "Messaggi dell'altra persona non letti" })
  unreadCount?: number;

  @ApiPropertyOptional({
    description: 'Match non ancora visto: "Deal Closed!" alla prima apertura (D60)',
  })
  isNew?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: '"Conosciuti all\'offsite" con il titolo (D152)',
  })
  offsiteTitle?: string | null;

  @ApiPropertyOptional({ description: 'Solo tra colleghi con Open space reciproco (D168)' })
  openSpaceColleagues?: true;

  @ApiPropertyOptional({ description: 'Conferme di lettura attive per entrambi (D63)' })
  readReceipts?: boolean;

  @ApiProperty({ format: 'date-time', description: 'Ultima attività, per ordinare e paginare' })
  activityAt: string;
}

export class MatchListDto {
  @ApiProperty({ type: MatchDto, isArray: true })
  matches: MatchDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Cursore della pagina successiva' })
  next: string | null;
}

export class MatchListQueryDto {
  @ApiPropertyOptional({ description: 'Cursore di `next`' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
