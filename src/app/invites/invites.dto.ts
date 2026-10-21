import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const INVITE_TYPES = [
  'sync_coffee',
  'post_review_drinks',
  'kickoff_dinner',
  'walk_and_talk',
] as const;
export const TIME_SLOTS = ['morning', 'lunch', 'afternoon', 'evening'] as const;
export type InviteType = (typeof INVITE_TYPES)[number];
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** Fasce orarie (D233): l'ora precisa deve stare dentro la fascia scelta (D146). */
export const SLOT_RANGES: Record<TimeSlot, [string, string]> = {
  morning: ['09:00', '12:00'],
  lunch: ['12:30', '14:30'],
  afternoon: ['15:00', '18:00'],
  evening: ['19:00', '22:00'],
};

export class InviteFieldsDto {
  @ApiProperty({ enum: INVITE_TYPES, description: 'Tipi a tema (D64)' })
  @IsIn(INVITE_TYPES)
  type: InviteType;

  @ApiProperty({ format: 'date', description: 'Da domani a 3 mesi (D197)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day: string;

  @ApiProperty({ enum: TIME_SLOTS })
  @IsIn(TIME_SLOTS)
  timeSlot: TimeSlot;

  @ApiPropertyOptional({ example: '18:30', description: 'Facoltativa, dentro la fascia (D146)' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time?: string;

  @ApiPropertyOptional({
    maxLength: 80,
    description: 'Nome del luogo, facoltativo; cifrato (D146, D183)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  venue?: string;

  @ApiProperty({ example: '058091', description: "Comune dell'elenco (D49)" })
  @Matches(/^\d{6}$/)
  cityId: string;
}

export class NewMeetingDto extends InviteFieldsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  matchId: string;
}

export class InviteResponseDto {
  @ApiProperty({
    enum: ['accept', 'decline', 'reschedule'],
    description: '"Accetto", "Declino con garbo", "Propongo un\'altra data" (D64)',
  })
  @IsIn(['accept', 'decline', 'reschedule'])
  answer: 'accept' | 'decline' | 'reschedule';

  @ApiPropertyOptional({ type: InviteFieldsDto, description: 'Solo per "Propongo un\'altra data"' })
  @IsOptional()
  @ValidateNested()
  @Type(() => InviteFieldsDto)
  proposal?: InviteFieldsDto;
}

export class InviteCityDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Città mostrata (D109)' })
  name: string;
}

export class InviteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  matchId: string;

  @ApiProperty()
  proposedByMe: boolean;

  @ApiProperty({ enum: INVITE_TYPES })
  type: InviteType;

  @ApiProperty({ format: 'date' })
  day: string;

  @ApiProperty({ enum: TIME_SLOTS })
  timeSlot: TimeSlot;

  @ApiPropertyOptional({ nullable: true })
  time: string | null;

  @ApiPropertyOptional({ nullable: true })
  venue: string | null;

  @ApiProperty({ type: InviteCityDto })
  city: InviteCityDto;

  @ApiProperty({
    enum: [
      'pending',
      'accepted',
      'declined',
      'replaced',
      'cancelled',
      'expired',
      'completed',
      'closed',
    ],
  })
  status: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  replacesId: string | null;

  @ApiPropertyOptional({
    enum: ['confirmed', 'awaiting_reply', 'to_reschedule', 'completed'],
    nullable: true,
    description: "Stato dello slot dell'Agenda (D162, D233)",
  })
  slotState: 'confirmed' | 'awaiting_reply' | 'to_reschedule' | 'completed' | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class SuggestionDto {
  @ApiProperty({ format: 'date' })
  day: string;

  @ApiProperty({ type: InviteCityDto })
  city: InviteCityDto;
}
