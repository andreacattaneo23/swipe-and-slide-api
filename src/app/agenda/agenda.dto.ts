import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { InviteDto } from '../invites/invites.dto';

export class AgendaQueryDto {
  @ApiProperty({ format: 'date' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @ApiProperty({ format: 'date', description: 'Al massimo 6 settimane dopo `from`' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}

export class UpcomingQueryDto {
  @ApiPropertyOptional({ description: 'Cursore di `next`' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AgendaPersonDto {
  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional({ nullable: true })
  photo: string | null;
}

/** Slot dell'Agenda: lo stesso oggetto dell'invito della chat (D145). */
export class MeetingDto extends InviteDto {
  @ApiPropertyOptional({
    type: AgendaPersonDto,
    description: 'Manca con la conversazione momentaneamente sospesa: lo slot resta neutro (D197)',
  })
  person?: AgendaPersonDto;

  @ApiProperty({ description: 'Conversazione momentaneamente sospesa (D82)' })
  paused: boolean;
}

export class AgendaTripDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: "Nome reale del comune scelto, solo per l'utente stesso (D149)" })
  city: string;

  @ApiProperty({ format: 'date' })
  from: string;

  @ApiProperty({ format: 'date' })
  to: string;
}

export class AgendaOffsiteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;
}

export class AgendaDto {
  @ApiProperty({ type: MeetingDto, isArray: true })
  meetings: MeetingDto[];

  @ApiProperty({
    type: AgendaTripDto,
    isArray: true,
    description: 'Fasce di sfondo, solo proprie (D149)',
  })
  trips: AgendaTripDto[];

  @ApiProperty({
    type: AgendaOffsiteDto,
    isArray: true,
    description: 'Promemoria degli offsite (D151)',
  })
  offsites: AgendaOffsiteDto[];
}

export class UpcomingDto {
  @ApiProperty({ type: MeetingDto, isArray: true })
  meetings: MeetingDto[];

  @ApiPropertyOptional({ nullable: true })
  next: string | null;
}

export class AgendaPeopleItemDto {
  @ApiProperty({ format: 'uuid' })
  matchId: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional({ nullable: true })
  photo: string | null;

  @ApiProperty({ description: "C'è già una proposta in sospeso: non si può scegliere (D147)" })
  hasPendingInvite: boolean;
}
