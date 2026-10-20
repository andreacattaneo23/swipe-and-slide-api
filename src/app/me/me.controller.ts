import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { companies, personalIdentities, profileReviews, users } from '../../infra/database/schema';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { REGISTRATION_DAYS } from '../auth/personal-identities.service';
import { ApprovalStatusDto, MeDto } from './me.dto';

/** Dati propri dell'account: mai dati di altre persone. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @Scopes('full', 'registration', 'approval', 'restore', 'limited')
  @ApiOkResponse({ type: MeDto })
  async me(@CurrentUser() me: AuthContext): Promise<MeDto> {
    const [row] = await this.db
      .select({ user: users, companyName: companies.name })
      .from(users)
      .leftJoin(companies, eq(companies.id, users.companyId))
      .where(eq(users.id, me.userId));
    if (!row) throw ApiError.unauthorized();
    const [identity] = await this.db
      .select({ provider: personalIdentities.provider })
      .from(personalIdentities)
      .where(and(eq(personalIdentities.userId, me.userId), isNull(personalIdentities.revokedAt)));
    const { user } = row;
    return {
      id: user.id,
      status: user.status,
      scope: me.scope,
      signInMethod: identity?.provider ?? null,
      company:
        user.companyId && row.companyName ? { id: user.companyId, name: row.companyName } : null,
      openSpaceEnabled: user.openSpace,
      openSpacePrompt: user.openSpacePromptAt !== null,
      reverificationDueAt: user.reverificationDueAt,
      deletionScheduledAt: user.deletionScheduledAt,
      deletionRequestedAt: user.deletionRequestedAt,
      registrationExpiresAt:
        user.status === 'registering'
          ? new Date(user.createdAt.getTime() + REGISTRATION_DAYS * 24 * 60 * 60 * 1000)
          : null,
    };
  }

  /** Stato della revisione: motivazione e tentativi rimasti solo qui (D141–D144). */
  @Get('approval')
  @Scopes('approval', 'limited', 'full')
  @ApiOkResponse({ type: ApprovalStatusDto })
  async approval(@CurrentUser() me: AuthContext): Promise<ApprovalStatusDto> {
    const [last] = await this.db
      .select()
      .from(profileReviews)
      .where(eq(profileReviews.userId, me.userId))
      .orderBy(desc(profileReviews.attempt))
      .limit(1);
    if (!last)
      return { status: 'none', dueAt: null, reason: null, explanation: null, attemptsLeft: 3 };
    const attemptsLeft = Math.max(0, 3 - last.attempt);
    if (last.outcome === 'pending') {
      const late = last.dueAt.getTime() < Date.now();
      return {
        status: late ? 'late' : 'pending',
        dueAt: last.dueAt,
        reason: null,
        explanation: null,
        attemptsLeft,
      };
    }
    if (last.outcome === 'approved') {
      return { status: 'approved', dueAt: null, reason: null, explanation: null, attemptsLeft };
    }
    return {
      status: last.attempt >= 3 ? 'blocked' : 'rejected',
      dueAt: null,
      reason: last.reason,
      explanation: last.explanation,
      attemptsLeft,
    };
  }
}
