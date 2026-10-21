import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { SWITCHABLE_TYPES } from '../../domain/notifications/notifications.service';

export class QuietRangeDto {
  @ApiProperty({ example: '22:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  start: string;

  @ApiProperty({ example: '07:00', description: 'Può passare la mezzanotte (D233)' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  end: string;
}

/** Preferenze delle notifiche (D65, D66, D114): tipi spenti, anteprime, "Modalità in riunione". */
export class NotificationPreferencesDto {
  @ApiProperty({
    enum: SWITCHABLE_TYPES,
    isArray: true,
    description: "Tipi spenti; l'esito dell'approvazione arriva sempre (D197)",
  })
  @IsArray()
  @IsIn(SWITCHABLE_TYPES, { each: true })
  disabledTypes: string[];

  @ApiProperty({
    description: 'Anteprime: nome di battesimo e inizio del messaggio, spente di base',
  })
  @IsBoolean()
  previews: boolean;

  @ApiProperty({
    type: QuietRangeDto,
    isArray: true,
    description: 'Fasce di ogni giorno, ora italiana',
  })
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuietRangeDto)
  quietHours: QuietRangeDto[];
}

export class DeviceDto {
  @ApiProperty({ description: 'Token di Expo Push' })
  @IsString()
  @Length(10, 200)
  pushToken: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}

export class TabsDto {
  @ApiProperty({ description: 'Messaggi non letti nei match attivi' })
  unreadMessages: number;

  @ApiProperty({ description: 'Match nuovi non ancora visti (punto della scheda Match)' })
  newMatches: boolean;

  @ApiProperty({
    description: "Proposta di meeting dell'altra persona non ancora vista, senza numeri (D145)",
  })
  agendaDot: boolean;
}
