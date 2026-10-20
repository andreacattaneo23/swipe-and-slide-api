import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OffsiteRecord, OffsitesService } from '../../domain/offsites/offsites.service';
import { OperatorContext } from '../auth/operator-context';
import { CurrentOperator, OperatorRoles } from '../auth/operator-roles.decorator';
import { ExplanationDto } from '../common/admin.dto';
import { by } from '../companies/companies.controller';

export class OffsiteListQueryDto {
  @ApiPropertyOptional({ description: "Cursore: `startsAt` dell'ultimo offsite della pagina" })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateOffsiteDto extends ExplanationDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) title: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @MaxLength(4000) description: string;
  @ApiProperty({ maxLength: 120 }) @IsString() @Length(1, 120) venueName: string;
  @ApiProperty({ maxLength: 240 }) @IsString() @Length(1, 240) venueAddress: string;
  @ApiProperty({ example: '015146' }) @Matches(/^\d{6}$/) cityId: string;
  @ApiProperty() @Type(() => Date) @IsDate() startsAt: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endsAt: Date;
  @ApiPropertyOptional({ nullable: true, minimum: 1 }) @IsOptional() @IsInt() @Min(1) capacity?:
    number | null;
  @ApiPropertyOptional({ default: false, description: 'Offsite dimostrativo (D42), immutabile' })
  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;
}

export class UpdateOffsiteDto extends PartialType(
  OmitType(CreateOffsiteDto, ['explanation', 'isDemo'] as const),
) {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @Length(3, 500)
  explanation: string;
}

export class OffsiteDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty({ nullable: true, type: String }) coverKey: string | null;
  @ApiProperty() venueName: string;
  @ApiProperty() venueAddress: string;
  @ApiProperty() cityId: string;
  @ApiProperty() startsAt: Date;
  @ApiProperty() endsAt: Date;
  @ApiProperty({ nullable: true, type: Number }) capacity: number | null;
  @ApiProperty({ enum: ['draft', 'published', 'cancelled', 'completed'] }) status: string;
  @ApiProperty() isDemo: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ nullable: true, type: Date }) publishedAt: Date | null;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt: Date | null;
  @ApiProperty({
    description: 'Iscritti arrotondati: 0 = "meno di 10", poi la decina per difetto (D167)',
  })
  attendeesRounded: number;
}

/** Offsite (D150): solo l'Amministratore; mai l'elenco né il numero esatto degli iscritti. */
@ApiTags('backoffice-offsites')
@ApiHeader({ name: 'X-Operator-Token', required: true })
@Controller('backoffice/offsites')
export class OffsitesController {
  constructor(private readonly offsites: OffsitesService) {}

  @Get()
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OffsiteDto, isArray: true })
  list(@Query() query: OffsiteListQueryDto): Promise<OffsiteRecord[]> {
    return this.offsites.list({ before: query.before, limit: query.limit ?? 50 });
  }

  @Post()
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OffsiteDto })
  create(
    @CurrentOperator() operator: OperatorContext,
    @Body() body: CreateOffsiteDto,
  ): Promise<OffsiteRecord> {
    const { explanation: _explanation, ...input } = body;
    return this.offsites.create(input, by(operator, body));
  }

  @Get(':id')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OffsiteDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OffsiteRecord> {
    return this.offsites.get(id);
  }

  @Patch(':id')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OffsiteDto })
  update(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOffsiteDto,
  ): Promise<OffsiteRecord> {
    const { explanation: _explanation, ...input } = body;
    return this.offsites.update(id, input, by(operator, body));
  }

  @Post(':id/publication')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OffsiteDto })
  publish(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<OffsiteRecord> {
    return this.offsites.publish(id, by(operator, body));
  }

  @Post(':id/cancellation')
  @OperatorRoles('admin')
  @ApiOkResponse({ type: OffsiteDto })
  cancel(
    @CurrentOperator() operator: OperatorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ExplanationDto,
  ): Promise<OffsiteRecord> {
    return this.offsites.cancel(id, by(operator, body));
  }
}
