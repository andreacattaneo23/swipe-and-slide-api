import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/scopes.decorator';

export class HealthDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';
}

/** Stato del servizio senza sessione e senza database, così non tiene sveglio Neon (D205). */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOkResponse({ type: HealthDto })
  health(): HealthDto {
    return { status: 'ok' };
  }
}
