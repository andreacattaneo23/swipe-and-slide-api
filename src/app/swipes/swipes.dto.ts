import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { TodaySlidesDto } from '../feed-chat/people.dto';

export class SwipeBodyDto {
  @ApiProperty({ format: 'uuid', description: "L'altra persona" })
  @IsUUID()
  userId: string;

  @ApiProperty({
    enum: ['like', 'pass', 'escalation'],
    description: 'Approvato, Fuori scope, Escalation (D53)',
  })
  @IsIn(['like', 'pass', 'escalation'])
  type: 'like' | 'pass' | 'escalation';

  @ApiPropertyOptional({ format: 'uuid', description: "Swipe dell'offsite (D152)" })
  @IsOptional()
  @IsUUID()
  offsiteId?: string;
}

export class RollbackBodyDto {
  @ApiProperty({ format: 'uuid', description: "La persona dell'ultimo swipe del giorno" })
  @IsUUID()
  userId: string;
}

/** Dati della schermata "Deal Closed!" (D60): qui compaiono per la prima volta cognome e azienda. */
export class DealClosedDto {
  @ApiProperty({ format: 'uuid' })
  matchId: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional({ nullable: true })
  lastName: string | null;

  @ApiProperty({ description: "Nome dell'azienda attuale dell'altra persona (D30)" })
  companyName: string;

  @ApiPropertyOptional({ nullable: true, description: 'URL firmato della foto principale' })
  photo: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Titolo dell\'offsite: "Conosciuti all\'offsite"',
  })
  offsiteTitle: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'Deadline dei 7 giorni per il primo messaggio (D62)',
  })
  deadlineAt: string;
}

export class SwipeResultDto {
  @ApiProperty()
  matched: boolean;

  @ApiPropertyOptional({ type: DealClosedDto })
  match?: DealClosedDto;

  @ApiProperty({ type: TodaySlidesDto })
  todaySlides: TodaySlidesDto;
}

export class RollbackResultDto {
  @ApiProperty({ type: TodaySlidesDto })
  todaySlides: TodaySlidesDto;
}
