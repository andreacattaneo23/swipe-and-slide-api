import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';

export class SearchQueryDto {
  @ApiPropertyOptional({ description: 'Prefisso del nome, almeno 2 caratteri' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  search?: string;
}

export class CityDto {
  @ApiProperty({ example: '015146' })
  id: string;

  @ApiProperty({ example: 'Milano' })
  name: string;

  @ApiProperty({ example: 'MI' })
  provinceCode: string;
}

export class DirectoryCompanyDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Solo il nome (D35): niente domini né conteggi (RC-56)' })
  name: string;
}

/** Elenchi consultabili per la registrazione e le impostazioni: comuni e aziende. */
@ApiTags('directory')
@ApiBearerAuth()
@Controller()
export class DirectoryController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly limiter: RateLimiter,
  ) {}

  /** Ricerca dei comuni per prefisso, sul nome normalizzato senza accenti. */
  @Get('cities')
  @Scopes('registration', 'approval', 'full')
  @ApiOkResponse({ type: CityDto, isArray: true })
  async cities(@Query() query: SearchQueryDto): Promise<CityDto[]> {
    const prefix = normalizeSearch(query.search ?? '');
    const rows = await this.db.execute<{ id: string; name: string; province_code: string }>(sql`
      select id, name, province_code from cities
       where is_active and search_name like ${`${prefix}%`}
       order by population desc, name limit 20`);
    return rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      provinceCode: row.province_code,
    }));
  }

  /**
   * Elenco per scegliere le aziende escluse (RC-56): solo aziende attive del proprio tipo e
   * diverse dalla propria, solo il nome; limite contro la copia massiva.
   */
  @Get('companies')
  @Scopes('registration', 'approval', 'full')
  @ApiOkResponse({ type: DirectoryCompanyDto, isArray: true })
  async companies(
    @CurrentUser() me: AuthContext,
    @Query() query: SearchQueryDto,
  ): Promise<DirectoryCompanyDto[]> {
    if (!(await this.limiter.hit(`companies:${me.userId}`, 60, 60)))
      throw ApiError.tooManyRequests();
    const prefix = (query.search ?? '').replace(/[\\%_]/g, (match) => `\\${match}`);
    const rows = await this.db.execute<{ id: string; name: string }>(sql`
      select z.id, z.name from companies z, users x
       where x.id = ${me.userId}::uuid and z.status = 'active' and z.is_demo = x.is_demo
         and z.id is distinct from x.company_id and z.name ilike ${`${prefix}%`}
       order by z.name limit 30`);
    return rows.rows.map((row) => ({ id: row.id, name: row.name }));
  }
}

/** Minuscolo e senza accenti, come `cities.search_name`. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\\%_]/g, '');
}
