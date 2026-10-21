import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CardDto, TodaySlidesDto } from '../feed-chat/people.dto';

export class FeedQueryDto {
  @ApiPropertyOptional({ enum: ['trips'], description: '"In trasferta nella mia città" (D52)' })
  @IsOptional()
  @IsIn(['trips'])
  filter?: 'trips';
}

export class FeedDto {
  @ApiProperty({ type: CardDto, isArray: true })
  cards: CardDto[];

  @ApiProperty({ description: '"Backlog vuoto": stessa risposta qualunque sia il motivo (D52)' })
  backlogEmpty: boolean;

  @ApiProperty({ type: TodaySlidesDto })
  todaySlides: TodaySlidesDto;

  @ApiPropertyOptional({
    description: "Presente e vero solo con l'Open space dell'utente attivo (D157)",
  })
  openSpaceEnabled?: true;

  @ApiPropertyOptional({
    enum: ['incomplete', 'ooo', 'unavailable'],
    description: "Solo lo stato dell'utente stesso quando non riceve il feed (D81, D109)",
  })
  state?: 'incomplete' | 'ooo' | 'unavailable';
}
