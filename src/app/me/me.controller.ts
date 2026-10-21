import { Controller, Get, Inject } from '@nestjs/common';
import { asDate } from '../../infra/database/timestamps';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { companies, personalIdentities, profileReviews, users } from '../../infra/database/schema';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { REGISTRATION_DAYS } from '../auth/personal-identities.service';
import { maskEmail } from '../../domain/email/mask-email';
import { SanctionsService } from '../../domain/safety/sanctions.service';
import { ApprovalStatusDto, MeDto } from './me.dto';

/** Dati propri dell'account: mai dati di altre persone. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sanctions: SanctionsService,
  ) {}

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
      .select({ provider: personalIdentities.provider, email: personalIdentities.email })
      .from(personalIdentities)
      .where(and(eq(personalIdentities.userId, me.userId), isNull(personalIdentities.revokedAt)));
    const { user } = row;
    const extra = await this.db.execute<{
      deletion_final_at: Date | null;
      consent_revoked: boolean;
      ooo_since: Date | null;
      left_id: string | null;
      left_name: string | null;
      new_id: string | null;
      new_name: string | null;
      first_name: string | null;
      work_email: string | null;
      missing: string[];
    }>(sql`
      select x.deletion_final_at, p.first_name,
             (select w.email from work_emails w where w.user_id = x.id and w.status = 'active'
               limit 1) as work_email,
             array_remove(array[
               case when (select count(*) from photos f where f.user_id = x.id
                            and f.status = 'approved') < 2 then 'photos' end,
               case when p.first_name is null then 'firstName' end,
               case when p.gender is null then 'gender' end,
               case when p.interested_in is null then 'interestedIn' end,
               case when p.home_city_id is null then 'homeCity' end], null) as missing,
             x.deletion_requested_at is not null
               and not exists (select 1 from consents c where c.user_id = x.id and c.type = 'art9'
                                 and c.revoked_at is null) as consent_revoked,
             p.ooo_since,
             case when c.left_company_excluded then f.id end as left_id,
             case when c.left_company_excluded then f.name end as left_name,
             case when c.new_company_unexcluded then t.id end as new_id,
             case when c.new_company_unexcluded then t.name end as new_name
        from users x
        left join profiles p on p.user_id = x.id
        left join lateral (select * from company_changes k where k.user_id = x.id
                            order by k.changed_at desc limit 1) c
               on x.excluded_companies_notice_at is not null
        left join companies f on f.id = c.from_company_id
        left join companies t on t.id = c.to_company_id
       where x.id = ${me.userId}::uuid`);
    const more = extra.rows[0];
    const notice =
      more && (more.left_id || more.new_id)
        ? {
            leftCompany: more.left_id ? { id: more.left_id, name: more.left_name ?? '' } : null,
            removedCurrentCompany: more.new_id
              ? { id: more.new_id, name: more.new_name ?? '' }
              : null,
          }
        : null;
    const sanction = (await this.sanctions.listFor(me.userId)).find((item) => item.active) ?? null;
    return {
      id: user.id,
      firstName: more?.first_name ?? null,
      personalEmail: identity?.email ?? null,
      workEmail: more?.work_email ? maskEmail(more.work_email) : null,
      missing: (more?.missing ?? []) as MeDto['missing'],
      sanction,
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
      deletionFinalAt: asDate(more?.deletion_final_at),
      consentRevoked: more?.consent_revoked === true,
      oooSince: asDate(more?.ooo_since),
      excludedCompaniesNotice: notice,
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
