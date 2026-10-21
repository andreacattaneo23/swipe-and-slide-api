import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TodaySlidesDto } from '../feed-chat/people.dto';

/** Lunghezza massima di un messaggio, controllata prima della cifratura (D197). */
export const MESSAGE_MAX_LENGTH = 1000;

export class SendMessageDto {
  @ApiProperty({ maxLength: MESSAGE_MAX_LENGTH, description: 'Solo testo ed emoji (D63)' })
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH * 2)
  text: string;

  @ApiProperty({
    format: 'uuid',
    description: "Generato dall'app: un nuovo tentativo non crea doppioni (D231)",
  })
  @IsUUID()
  clientMessageId: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Messaggi successivi a questo (ripresa, D231)',
  })
  @IsOptional()
  @IsUUID()
  after?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Messaggi precedenti a questo (pagine indietro)',
  })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ReadBodyDto {
  @ApiProperty({ format: 'uuid', description: "Ultimo messaggio letto dell'altra persona" })
  @IsUUID()
  messageId: string;
}

export class MessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  clientMessageId: string;

  @ApiProperty({ description: 'Vero per i messaggi scritti da chi chiede' })
  mine: boolean;

  @ApiProperty()
  text: string;

  @ApiProperty({
    format: 'date-time',
    description: "Ordine deciso dal server, mai dall'ora del telefono",
  })
  createdAt: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      'Solo sui propri messaggi e solo con le conferme di lettura attive per entrambi (D63)',
  })
  readAt?: string | null;
}

export class MessagesDto {
  @ApiProperty({ type: MessageDto, isArray: true })
  messages: MessageDto[];

  @ApiProperty({ description: 'Ci sono messaggi più vecchi di questa pagina' })
  hasMore: boolean;
}

export class SentMessageDto {
  @ApiProperty({ type: MessageDto })
  message: MessageDto;

  @ApiProperty({ description: 'Primo messaggio del match: 3 slide in più a chi scrive (D62)' })
  bonusAwarded: boolean;

  @ApiProperty({ type: TodaySlidesDto })
  todaySlides: TodaySlidesDto;
}
