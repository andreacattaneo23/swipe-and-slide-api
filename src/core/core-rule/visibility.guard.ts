import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DATABASE, Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { AuthenticatedRequest } from '../auth/auth-context';
import { CoreRuleService } from './core-rule.service';
import { EXPOSES_USER, ExposesUserOptions } from './exposes-user.decorator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard delle rotte con `@ExposesUser`: ricava l'altro utente (dal parametro o dal match) e
 * risponde `404` neutro se la regola è falsa, con lo stesso corpo di un identificativo
 * inesistente (RC-60).
 */
@Injectable()
export class VisibilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly coreRule: CoreRuleService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ExposesUserOptions | undefined>(EXPOSES_USER, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const me = request.auth?.userId;
    if (!me) throw ApiError.notFound();
    if ('perItem' in options) return true;
    if (options.rule === 'interact') {
      const params = request.params as Record<string, string | undefined>;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const other = options.body ? body[options.body] : params[options.param ?? 'id'];
      if (typeof other !== 'string' || !UUID.test(other)) throw ApiError.notFound();
      if (!(await this.coreRule.canInteract(me, other))) throw ApiError.notFound();
      return true;
    }
    const matchId = options.body
      ? ((request.body ?? {}) as Record<string, unknown>)[options.body]
      : (request.params as Record<string, string | undefined>)[options.match ?? 'id'];
    if (typeof matchId !== 'string' || !UUID.test(matchId)) throw ApiError.notFound();
    // Regola `match`: partecipante di un match attivo, con entrambi gli account visibili salvo
    // le letture ammesse nella conversazione sospesa (`paused`)
    const paused = options.paused === true;
    const result = await this.db.execute<{ ok: boolean }>(sql`
      select (m.status = 'active' and ${me}::uuid in (m.user_a_id, m.user_b_id)
              and (${paused} or (account_visible(m.user_a_id) and account_visible(m.user_b_id))))
             is true as ok
        from matches m where m.id = ${matchId}::uuid`);
    if (result.rows[0]?.ok !== true) throw ApiError.notFound();
    return true;
  }
}
