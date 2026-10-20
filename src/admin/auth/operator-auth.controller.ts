import { Body, Controller, Get, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { eq } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { operators } from '../../infra/database/schema';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { ApiError } from '../../infra/http/api-error';
import { Public } from '../../core/auth/scopes.decorator';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorContext } from './operator-context';
import { CurrentOperator, OperatorRoles } from './operator-roles.decorator';

export class OperatorEmailDto {
  @ApiProperty({ example: 'operatore@example.invalid' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class OperatorVerifyDto extends OperatorEmailDto {
  @ApiProperty({ example: '123456', description: 'Codice OTP ricevuto via email' })
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @ApiProperty({ example: '654321', description: "Codice TOTP dell'app di autenticazione (D88)" })
  @IsString()
  @Matches(/^\d{6}$/)
  totp: string;
}

export class OperatorSessionDto {
  @ApiProperty({
    description: "Token della sessione, da inviare nell'intestazione `X-Operator-Token`",
  })
  token: string;

  @ApiProperty()
  expiresAt: Date;
}

export class OperatorMeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['admin', 'moderator', 'support'], isArray: true })
  roles: string[];

  @ApiProperty()
  lastTotpAt: Date;
}

@ApiTags('backoffice-auth')
@Controller('backoffice/auth')
export class OperatorAuthController {
  constructor(
    private readonly auth: OperatorAuthService,
    private readonly limiter: RateLimiter,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  @Post('code')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'Risposta uguale per ogni indirizzo' })
  async code(@Body() body: OperatorEmailDto, @Ip() ip: string): Promise<{ status: 'sent' }> {
    if (!(await this.limiter.hit(`operator-code:${ip}`, 10, 60))) throw ApiError.tooManyRequests();
    await this.auth.requestCode(body.email, ip);
    return { status: 'sent' };
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: OperatorSessionDto })
  async verify(@Body() body: OperatorVerifyDto, @Ip() ip: string): Promise<OperatorSessionDto> {
    if (!(await this.limiter.hit(`operator-verify:${ip}`, 10, 60)))
      throw ApiError.tooManyRequests();
    return this.auth.verify(body.email, body.code, body.totp);
  }

  @Get('me')
  @OperatorRoles('admin', 'moderator', 'support')
  @ApiHeader({ name: 'X-Operator-Token', required: true })
  @ApiOkResponse({ type: OperatorMeDto })
  async me(@CurrentOperator() operator: OperatorContext): Promise<OperatorMeDto> {
    const [row] = await this.db
      .select({ name: operators.name })
      .from(operators)
      .where(eq(operators.id, operator.operatorId));
    return {
      id: operator.operatorId,
      name: row?.name ?? '',
      roles: operator.roles,
      lastTotpAt: operator.lastTotpAt,
    };
  }

  @Post('logout')
  @OperatorRoles('admin', 'moderator', 'support')
  @ApiHeader({ name: 'X-Operator-Token', required: true })
  @HttpCode(204)
  async logout(@CurrentOperator() operator: OperatorContext): Promise<void> {
    await this.auth.logout(operator.sessionId);
  }
}
