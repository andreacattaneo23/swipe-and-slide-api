import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { auditLog, cities, operators } from '../../infra/database/schema';
import { configTable } from '../../infra/database/schema-safety';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { normalizeEmail } from '../../domain/email/email-address';
import { OperatorAction } from '../../domain/companies/companies.service';
import { SafetySettings } from '../../domain/safety/safety-settings.service';
import { OperatorRole } from '../auth/operator-context';

export interface AuditEntryView {
  id: string;
  at: Date;
  type: string;
  action: string;
  operatorId: string | null;
  operatorName: string | null;
  /** Oggetto come `tipo:identificativo interno`, mai email, nomi o contenuti (D112). */
  subjectRef: string | null;
  explanation: string | null;
  details: unknown;
}

export interface ConfigLimit {
  key: string;
  value: number;
  min: number;
  max: number;
  unit: 'count' | 'hours' | 'days';
}

/** Unità e limiti dei parametri numerici, per il modulo del backoffice. */
function limitShape(key: string): Omit<ConfigLimit, 'key' | 'value'> {
  const unit: ConfigLimit['unit'] = key.endsWith('_hours')
    ? 'hours'
    : /(_days|\.years|_months)$/.test(key)
      ? 'days'
      : 'count';
  return { min: 0, max: unit === 'hours' ? 720 : unit === 'days' ? 3650 : 1000, unit };
}

/** Tipo atteso di ogni chiave della configurazione modificabile dal backoffice (D89). */
const CONFIG_KINDS: Record<string, 'int' | 'string[]'> = {
  'open_space.max_changes': 'int',
  'open_space.period_days': 'int',
  'excluded_companies.max': 'int',
  'excluded_companies.max_changes': 'int',
  'excluded_companies.period_days': 'int',
  'excluded_companies.min_days_before_removal': 'int',
  'approval.due_hours': 'int',
  'approval.team_alert_hours': 'int',
  'approval.rejected_deletion_days': 'int',
  'approval.rejected_notice_days': 'int',
  'swipes.daily_likes': 'int',
  'swipes.daily_escalations': 'int',
  'moderation.severe_hours': 'int',
  'moderation.standard_hours': 'int',
  'reports.daily_max': 'int',
  'sanctions.suspension_days': 'int',
  'sanctions.appeal_months': 'int',
  'appeals.response_days': 'int',
  'expulsion.deletion_days': 'int',
  'blocked_hashes.years': 'int',
  'age_verification.document_hours': 'int',
  'works_at_my_company.reverification_days': 'int',
  'works_at_my_company.outcome_days': 'int',
  'directory_alerts.threshold': 'int',
  'directory_alerts.period_days': 'int',
  'company_removal.interval_hours': 'int',
  'stats.min_count': 'int',
  'review_window.max_days': 'int',
  'review_window.max_attempts': 'int',
  'word_filter.words': 'string[]',
  'photo_check.reject': 'string[]',
  'photo_check.review': 'string[]',
};

/**
 * Strumenti dell'Amministratore (D89, D99, D112): audit con esportazione registrata a sua volta,
 * statistiche aggregate con la soglia, configurazione con audit, città, operatori e ruoli.
 */
/** Tassonomie a tema del profilo e le loro tabelle (modulo del profilo, D130). */
export const TAXONOMY_IDS = [
  'interests',
  'practiceAreas',
  'lookingFor',
  'profileQuestions',
] as const;
export type TaxonomyId = (typeof TAXONOMY_IDS)[number];
const TAXONOMY_TABLES: Record<TaxonomyId, string> = {
  interests: 'interests',
  practiceAreas: 'practice_areas',
  lookingFor: 'looking_for_options',
  profileQuestions: 'profile_questions',
};

@Injectable()
export class AdminToolsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly settings: SafetySettings,
  ) {}

  async auditEntries(params: {
    from?: Date;
    to?: Date;
    type?: 'action' | 'security';
    action?: string;
    /** Cursore: identificativo dell'ultima riga della pagina precedente. */
    before?: string;
    limit: number;
  }): Promise<AuditEntryView[]> {
    const conditions = [];
    if (params.from) conditions.push(gte(auditLog.performedAt, params.from));
    if (params.to) conditions.push(lt(auditLog.performedAt, params.to));
    if (params.type) conditions.push(eq(auditLog.type, params.type));
    if (params.action) conditions.push(sql`${auditLog.action}::text = ${params.action}`);
    if (params.before) {
      conditions.push(sql`(${auditLog.performedAt}, ${auditLog.id}) <
        (select performed_at, id from audit_log where id = ${params.before}::uuid)`);
    }
    const rows = await this.db
      .select({ entry: auditLog, operatorName: operators.name })
      .from(auditLog)
      .leftJoin(operators, eq(operators.id, auditLog.operatorId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.performedAt), desc(auditLog.id))
      .limit(params.limit);
    return rows.map(({ entry, operatorName }) => ({
      id: entry.id,
      at: entry.performedAt,
      type: entry.type,
      action: entry.action,
      operatorId: entry.operatorId,
      operatorName,
      subjectRef: entry.objectType
        ? `${entry.objectType}${entry.objectId ? `:${entry.objectId}` : ''}`
        : null,
      explanation: entry.explanation,
      details: entry.details,
    }));
  }

  /** Esportazione per periodo in CSV o JSON; l'esportazione stessa finisce nell'audit (D197). */
  async exportAudit(
    params: {
      from?: Date;
      to?: Date;
      type?: 'action' | 'security';
      action?: string;
      format: 'csv' | 'json';
    },
    by: { operatorId: string; sessionId: string },
  ): Promise<string> {
    if (params.from && params.to && params.to <= params.from) {
      throw ApiError.badRequest('validation', { field: 'to' });
    }
    const rows = await this.auditEntries({ ...params, limit: 50_000 });
    await this.audit.write({
      type: 'action',
      action: 'audit_exported',
      operatorId: by.operatorId,
      sessionId: by.sessionId,
      objectType: 'audit',
      details: {
        format: params.format,
        rows: rows.length,
        from: params.from?.toISOString() ?? null,
        to: params.to?.toISOString() ?? null,
      },
    });
    if (params.format === 'json') return JSON.stringify(rows);
    const header = 'id,performed_at,type,action,operator,subject,explanation,details';
    return [
      header,
      ...rows.map((row) =>
        [
          row.id,
          row.at.toISOString(),
          row.type,
          row.action,
          row.operatorName ?? '',
          row.subjectRef ?? '',
          row.explanation ?? '',
          JSON.stringify(row.details ?? {}),
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\n');
  }

  /** Statistiche aggregate con la soglia applicata nel database (D89): `null` sotto 10. */
  async stats(): Promise<{ generatedAt: Date; values: Record<string, number | null> }> {
    const result = await this.db.execute<{ stats: Record<string, number | null> }>(
      sql`select backoffice_stats() as stats`,
    );
    return { generatedAt: new Date(), values: result.rows[0]?.stats ?? {} };
  }

  /** Configurazione per il backoffice: limiti numerici, elenchi, tassonomie e città. */
  async systemConfig(): Promise<{
    limits: ConfigLimit[];
    lists: { key: string; items: string[] }[];
    taxonomies: { id: TaxonomyId; items: { key: string; active: boolean }[] }[];
    citiesCount: number;
  }> {
    const entries = await this.config();
    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(cities)
      .where(eq(cities.isActive, true));
    return {
      limits: entries
        .filter((entry) => CONFIG_KINDS[entry.key] === 'int')
        .map((entry) => ({ key: entry.key, value: Number(entry.value), ...limitShape(entry.key) })),
      lists: entries
        .filter((entry) => CONFIG_KINDS[entry.key] === 'string[]')
        .map((entry) => ({
          key: entry.key,
          items: Array.isArray(entry.value) ? (entry.value as string[]) : [],
        })),
      // Tassonomie a tema del profilo (D130): voci e stato dalle tabelle del modulo del profilo
      taxonomies: await this.taxonomies(),
      citiesCount: Number(count?.n ?? 0),
    };
  }

  async setLimit(key: string, value: number, by: OperatorAction): Promise<ConfigLimit> {
    if (CONFIG_KINDS[key] !== 'int') throw ApiError.notFound();
    const shape = limitShape(key);
    if (!Number.isInteger(value) || value < shape.min || value > shape.max) {
      throw ApiError.badRequest('validation', { field: 'value' });
    }
    await this.setConfig(key, value, by);
    return { key, value, ...shape };
  }

  async config(): Promise<{ key: string; value: unknown; updatedAt: Date }[]> {
    const rows = await this.db.select().from(configTable).orderBy(asc(configTable.key));
    return rows
      .filter((row) => row.key in CONFIG_KINDS)
      .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt }));
  }

  async setConfig(key: string, value: unknown, by: OperatorAction): Promise<void> {
    const kind = CONFIG_KINDS[key];
    if (!kind) throw ApiError.notFound();
    const valid =
      kind === 'int'
        ? Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100_000
        : Array.isArray(value) &&
          value.length <= 2000 &&
          value.every((item) => typeof item === 'string' && item.length <= 80);
    if (!valid) throw ApiError.badRequest('validation', { field: 'value' });
    await this.db.transaction(async (tx) => {
      await tx
        .insert(configTable)
        .values({ key, value, updatedBy: by.operatorId })
        .onConflictDoUpdate({
          target: configTable.key,
          set: { value, updatedBy: by.operatorId, updatedAt: sql`now()` },
        });
      // Le parole del filtro non entrano nell'audit: solo il conteggio
      await this.audit.write(
        {
          type: 'action',
          action: 'config_changed',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'config',
          objectId: key,
          explanation: by.explanation,
          details:
            kind === 'int' ? { value: value as number } : { items: (value as string[]).length },
        },
        tx,
      );
    });
    this.settings.invalidate();
  }

  /** Voci delle quattro tassonomie a tema, nell'ordine dell'app. */
  async taxonomies(): Promise<{ id: TaxonomyId; items: { key: string; active: boolean }[] }[]> {
    const result: { id: TaxonomyId; items: { key: string; active: boolean }[] }[] = [];
    for (const id of TAXONOMY_IDS) {
      const rows = await this.db.execute<{ key: string; active: boolean }>(
        sql`select code as key, is_active as active from ${sql.identifier(TAXONOMY_TABLES[id])}
             order by position, code`,
      );
      result.push({ id, items: rows.rows });
    }
    return result;
  }

  /**
   * Attiva o spegne una voce di una tassonomia (D130): le voci non si cancellano, così i profili
   * che la usano restano validi; l'app la nasconde dalle scelte nuove. Con audit.
   */
  async setTaxonomyItem(
    taxonomy: string,
    key: string,
    active: boolean,
    by: OperatorAction,
  ): Promise<{ key: string; active: boolean }> {
    if (!(TAXONOMY_IDS as readonly string[]).includes(taxonomy)) throw ApiError.notFound();
    const table = TAXONOMY_TABLES[taxonomy as TaxonomyId];
    await this.db.transaction(async (tx) => {
      const updated = await tx.execute(
        sql`update ${sql.identifier(table)} set is_active = ${active} where code = ${key}`,
      );
      if (!updated.rowCount) throw ApiError.notFound();
      await this.audit.write(
        {
          type: 'action',
          action: 'config_changed',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'config',
          objectId: `taxonomies.${taxonomy}`,
          explanation: by.explanation,
          details: { key, active },
        },
        tx,
      );
    });
    return { key, active };
  }

  async cities(): Promise<{ id: string; name: string; provinceCode: string }[]> {
    return this.db
      .select({ id: cities.id, name: cities.name, provinceCode: cities.provinceCode })
      .from(cities)
      .where(eq(cities.isActive, true))
      .orderBy(asc(cities.name));
  }

  async operators(): Promise<
    { id: string; name: string; roles: OperatorRole[]; status: string; createdAt: Date }[]
  > {
    return this.db
      .select({
        id: operators.id,
        name: operators.name,
        roles: operators.roles,
        status: operators.status,
        createdAt: operators.createdAt,
      })
      .from(operators)
      .orderBy(asc(operators.name));
  }

  /** Nuovo operatore: accede con l'email e il codice ricevuto per email (D88, D244). */
  async createOperator(
    input: { email: string; name: string; roles: OperatorRole[] },
    by: OperatorAction,
  ): Promise<{ id: string }> {
    const email = normalizeEmail(input.email);
    if (!email) throw ApiError.badRequest('validation', { field: 'email' });
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(operators)
        .values({
          email: email.email,
          name: input.name.trim(),
          roles: input.roles,
          status: 'active',
        })
        .onConflictDoNothing()
        .returning({ id: operators.id });
      if (!created) throw ApiError.conflict('conflict');
      await this.audit.write(
        {
          type: 'action',
          action: 'operator_created',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'operator',
          objectId: created.id,
          explanation: by.explanation,
          details: { roles: input.roles.join(',') },
        },
        tx,
      );
      return { id: created.id };
    });
  }

  async updateOperator(
    id: string,
    input: { roles?: OperatorRole[]; status?: 'active' | 'disabled' },
    by: OperatorAction,
  ): Promise<void> {
    if (
      id === by.operatorId &&
      (input.status === 'disabled' || (input.roles && !input.roles.includes('admin')))
    ) {
      // L'Amministratore non toglie a sé stesso l'accesso o il ruolo
      throw ApiError.conflict('conflict');
    }
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(operators)
        .set({
          ...(input.roles ? { roles: input.roles } : {}),
          ...(input.status ? { status: input.status } : {}),
        })
        .where(eq(operators.id, id))
        .returning({ id: operators.id });
      if (!updated.length) throw ApiError.notFound();
      await this.audit.write(
        {
          type: 'action',
          action: 'operator_updated',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'operator',
          objectId: id,
          explanation: by.explanation,
          details: { roles: input.roles?.join(',') ?? null, status: input.status ?? null },
        },
        tx,
      );
    });
  }
}

function csvCell(value: string): string {
  // Celle che iniziano con una formula non vengono eseguite dai fogli di calcolo
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
