import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsDateString, Matches } from 'class-validator';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { TripsService } from '../../domain/trips/trips.service';
import { CityRefDto } from '../profile/profile.dto';

export class TripDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: CityRefDto, description: 'Comune scelto, con il nome reale (solo per sé)' })
  city: CityRefDto;

  @ApiProperty({ example: '2026-11-02' })
  startDate: string;

  @ApiProperty({ example: '2026-11-06' })
  endDate: string;

  @ApiProperty({ description: 'Primo giorno in cui si compare nella città: 14 giorni prima (D57)' })
  visibleFrom: string;

  @ApiProperty()
  visibleNow: boolean;
}

export class TripsDto {
  @ApiProperty({ type: TripDto, isArray: true })
  trips: TripDto[];

  @ApiProperty({ description: 'Massimo delle trasferte pianificate (5, D57)' })
  max: number;

  @ApiProperty({ description: '"Mostra il calendario nel profilo" (D109)' })
  showCalendar: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Solo oltre il limite di frequenza: da quando se ne potrà aggiungere una',
  })
  creatableAt: Date | null;
}

export class TripInputDto {
  @ApiProperty({ description: 'Codice ISTAT del comune di destinazione' })
  @Matches(/^[0-9]{6}$/)
  cityId: string;

  @ApiProperty({ example: '2026-11-02', description: 'Primo giorno' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @ApiProperty({ example: '2026-11-06', description: 'Ultimo giorno, compreso' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;
}

/**
 * Modalità trasferta (D50, D57, D109): elenco delle proprie trasferte, creazione, modifica e
 * cancellazione con effetto immediato. "Mostra il calendario nel profilo" si cambia con
 * `PATCH /me/profile` (`showCalendar`).
 */
@ApiTags('trips')
@ApiBearerAuth()
@Controller('me/trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @Scopes('approval', 'full')
  @ApiOkResponse({ type: TripsDto })
  list(@CurrentUser() me: AuthContext): Promise<TripsDto> {
    return this.trips.overview(me.userId);
  }

  @Post()
  @Scopes('approval', 'full')
  @ApiOkResponse({ type: TripDto })
  create(@CurrentUser() me: AuthContext, @Body() body: TripInputDto): Promise<TripDto> {
    return this.trips.create(me.userId, body);
  }

  @Put(':id')
  @Scopes('approval', 'full')
  @ApiOkResponse({ type: TripDto })
  update(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TripInputDto,
  ): Promise<TripDto> {
    return this.trips.update(me.userId, id, body);
  }

  @Delete(':id')
  @Scopes('approval', 'full')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.trips.remove(me.userId, id);
  }
}
